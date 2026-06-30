/**
 * Real, end-to-end pipeline running fully on Lovable.
 * - Upload original to the `uploads` storage bucket
 * - Use ffmpeg.wasm in the browser to read duration, then slice clips
 * - Lovable AI Gateway picks viral moments + titles
 * - Upload rendered MP4 clips to the `clips` bucket and store signed URLs
 *
 * No external APIs. No external workers.
 */
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import { supabase } from "@/integrations/supabase/client";
import { ensureSessionUser } from "@/lib/session";
import { generateClipSuggestions } from "@/lib/ai.functions";
import type { PipelineConfig, VideoStage } from "@/lib/autocliper-types";

interface StartParams {
  file: File;
  title: string;
  config: PipelineConfig;
  clipCount: number;
}

const MAX_RENDER_CLIP_SECONDS = 25;

let ffmpegSingleton: FFmpeg | null = null;
async function getFFmpeg(onLog?: (msg: string) => void): Promise<FFmpeg> {
  if (ffmpegSingleton) return ffmpegSingleton;
  const ff = new FFmpeg();
  ff.on("log", ({ message }) => onLog?.(message));
  // Try multiple CDNs in case one is blocked / rate-limited / down. Order is
  // fastest-first; esm.sh proxies npm reliably from Cloudflare.
  const cdns = [
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm",
    "https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm",
    "https://esm.sh/@ffmpeg/core@0.12.10/dist/esm",
    "https://cdn.skypack.dev/@ffmpeg/core@0.12.10/dist/esm",
    "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/esm",
  ];
  const errors: string[] = [];
  for (const base of cdns) {
    try {
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
        toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
      ]);
      await ff.load({ coreURL, wasmURL });
      ffmpegSingleton = ff;
      return ff;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${new URL(base).hostname}: ${msg}`);
    }
  }
  throw new Error(
    `Could not load ffmpeg engine from any CDN. Check your internet / ad-blocker and try again.\n${errors.join("\n")}`,
  );
}

export async function startRealPipeline(params: StartParams): Promise<string> {
  // 0. Make sure we have an auth session — RLS scopes every row to the user.
  const user = await ensureSessionUser();

  // 1. Insert video row owned by this user
  const { data: inserted, error: insertErr } = await supabase
    .from("videos")
    .insert({
      user_id: user.id,
      title: params.title,
      source_url: null,
      source_type: "upload",
      status: "processing",
      stage: "queued",
      progress: 0,
      log_lines: ["[INIT] AutoCliper pipeline starting…"],
      config: params.config as never,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) throw new Error(insertErr?.message ?? "Failed to create video row");
  const videoId = inserted.id;

  // fire and forget
  runPipeline(videoId, user.id, params).catch(async (err) => {
    console.error("[pipeline] failed", err);
    await supabase
      .from("videos")
      .update({
        status: "failed",
        stage: "failed",
        error: err instanceof Error ? err.message : String(err),
      })
      .eq("id", videoId);
  });

  return videoId;
}

async function runPipeline(videoId: string, userId: string, params: StartParams) {
  const log: string[] = ["[INIT] AutoCliper pipeline starting…"];
  const push = async (
    line: string,
    patch: { stage?: VideoStage; progress?: number } = {},
  ) => {
    log.push(line);
    await supabase
      .from("videos")
      .update({
        log_lines: log,
        ...(patch.stage ? { stage: patch.stage } : {}),
        ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
      })
      .eq("id", videoId);
  };

  // 1. Upload original
  await push(`📤 Uploading source file (${(params.file.size / 1_000_000).toFixed(1)} MB)…`, {
    stage: "downloading",
    progress: 5,
  });
  const ext = params.file.name.split(".").pop() || "mp4";
  const sourceKey = `${userId}/${videoId}/source.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("uploads")
    .upload(sourceKey, params.file, { upsert: true, contentType: params.file.type || "video/mp4" });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  await push("✅ Source uploaded to Lovable Cloud storage", { progress: 20 });

  // 2. Load ffmpeg + probe duration. Mounting the File through WORKERFS avoids
  // copying large YouTube MP4s into wasm memory up front, which is where the UI
  // could sit forever at 35% on some browsers.
  await push("🛠️  Loading ffmpeg.wasm in the browser…", {
    stage: "transcribing",
    progress: 28,
  });
  const ff = await getFFmpeg();
  await push("   ffmpeg ready · mounting source without memory copy…", { progress: 34 });

  const mountPoint = `/input-${videoId}`;
  const mountedName = `source.${ext.toLowerCase()}`;
  const inputName = `${mountPoint}/${mountedName}`;
  await prepareMountedInput(ff, mountPoint, mountedName, params.file);
  await push("   source mounted · reading duration…", { progress: 36 });

  let duration = 0;
  try {
    duration = await probeDuration(params.file, 6000);
  } catch {
    await push("   browser couldn't read metadata, reading MP4 duration…", { progress: 38 });
  }
  if (!duration || !isFinite(duration)) {
    duration = await probeMp4Duration(params.file);
  }
  if (!duration || !isFinite(duration)) {
    await push("   MP4 duration unavailable, probing with ffprobe…", { progress: 40 });
    duration = await probeDurationWithFFmpeg(ff, inputName);
  }
  if (!duration || !isFinite(duration) || duration <= 0) {
    throw new Error("Could not determine video duration");
  }
  await push(`🎬 Source duration: ${fmtTime(duration)} (${Math.floor(duration)}s)`, {
    progress: 42,
  });

  // 3. Ask Lovable AI for viral moments
  await push("🧠 Lovable AI is selecting viral moments…", {
    stage: "selecting",
    progress: 50,
  });
  const { clips: suggestions } = await generateClipSuggestions({
    data: {
      title: params.title,
      durationSec: Math.floor(duration),
      count: params.clipCount,
    },
  });
  await push(`🏆 ${suggestions.length} clips selected by AI:`, { progress: 60 });
  for (const c of suggestions) {
    await push(`   • [${fmtTime(c.start_time)}–${fmtTime(c.end_time)}]  ${c.score}%  ${c.title}`);
  }

  // 4. Render each clip with ffmpeg.wasm, upload to clips bucket
  await push("✂️  Rendering clips with ffmpeg.wasm…", {
    stage: "rendering",
    progress: 65,
  });

  const setProgressOnly = async (progress: number) => {
    await supabase
      .from("videos")
      .update({ progress })
      .eq("id", videoId);
  };

  for (let i = 0; i < suggestions.length; i++) {
    const c = suggestions[i];
    const outName = `clip_${i}.mp4`;
    const startStr = c.start_time.toString();
    const effectiveEnd = Math.min(c.end_time, c.start_time + MAX_RENDER_CLIP_SECONDS);
    const durationSec = Math.max(1, effectiveEnd - c.start_time);
    const dur = durationSec.toString();

    await push(`   rendering ${i + 1}/${suggestions.length} · ${c.title.slice(0, 40)}…`);

    const buildFastCutArgs = (): string[] => [
      "-hide_banner",
      "-noaccurate_seek",
      "-ss",
      startStr,
      "-i",
      inputName,
      "-t",
      dur,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-sn",
      "-dn",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      "-avoid_negative_ts",
      "make_zero",
      "-y",
      outName,
    ];

    let blob: Blob | null = null;
    let usedPlan = "browser recorder";
    try {
      blob = await renderClipWithMediaRecorder(params.file, c.start_time, durationSec, params.config.aspect_ratio, (ratio) => {
        const pct = 65 + ((i + Math.min(0.98, ratio)) / suggestions.length) * 33;
        void setProgressOnly(Math.min(98, Math.round(pct * 10) / 10));
      });
    } catch (err) {
      await push(`   ⚠️  browser recorder failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!blob) {
      usedPlan = "instant safe cut";
      await push(`   ↻ clip ${i + 1} retrying with instant safe cut…`);
      let exitCode = -1;
      try {
        exitCode = await execWithProgress(ff, buildFastCutArgs(), 120_000, durationSec, (ratio) => {
          const pct = 65 + ((i + Math.min(0.98, ratio)) / suggestions.length) * 33;
          void setProgressOnly(Math.min(98, Math.round(pct * 10) / 10));
        });
      } catch (err) {
        await push(`   ⚠️  instant safe cut failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (exitCode !== 0) {
        throw new Error(`Clip ${i + 1} render timed out or failed`);
      }
      const fileData = (await ff.readFile(outName)) as Uint8Array;
      blob = new Blob([fileData as BlobPart], { type: "video/mp4" });
    }

    const clipKey = `${userId}/${videoId}/clip_${i}.${getClipExtension(blob.type)}`;
    const { error: clipUpErr } = await supabase.storage
      .from("clips")
      .upload(clipKey, blob, { upsert: true, contentType: blob.type || "video/mp4" });
    if (clipUpErr) throw new Error(`Clip upload failed: ${clipUpErr.message}`);

    const { data: signed } = await supabase.storage
      .from("clips")
      .createSignedUrl(clipKey, 60 * 60 * 24 * 7);

    await supabase.from("clips").insert({
      user_id: userId,
      video_id: videoId,
      title: c.title,
      hook: c.hook,
      hashtags: c.hashtags,
      start_time: c.start_time,
      end_time: effectiveEnd,
      score: c.score,
      aspect_ratio: params.config.aspect_ratio,
      video_url: signed?.signedUrl ?? null,
    });

    try {
      await ff.deleteFile(outName);
    } catch {
      /* ignore */
    }

    const pct = 65 + Math.round(((i + 1) / suggestions.length) * 33);
    await push(`   ✅ clip ${i + 1} uploaded (${usedPlan})`, { progress: pct });
  }

  await cleanupMountedInput(ff, mountPoint);

  await push("🎉 Pipeline complete · clips ready to download", { progress: 100 });
  await supabase
    .from("videos")
    .update({ status: "completed", stage: "completed", progress: 100, log_lines: log })
    .eq("id", videoId);
}

async function prepareMountedInput(ff: FFmpeg, mountPoint: string, name: string, file: File) {
  await cleanupMountedInput(ff, mountPoint);
  try {
    await ff.createDir(mountPoint);
  } catch {
    /* directory may already exist after a previous attempt */
  }
  await ff.mount("WORKERFS" as never, { blobs: [{ name, data: file }] }, mountPoint);
}

async function cleanupMountedInput(ff: FFmpeg, mountPoint: string) {
  try {
    await ff.unmount(mountPoint);
  } catch {
    /* ignore */
  }
  try {
    await ff.deleteDir(mountPoint);
  } catch {
    /* ignore */
  }
}

function probeDuration(file: File, timeoutMs = 8000): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const cleanup = () => {
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
    };
    const t = setTimeout(() => {
      cleanup();
      reject(new Error("metadata timeout"));
    }, timeoutMs);
    v.onloadedmetadata = () => {
      clearTimeout(t);
      const d = v.duration;
      cleanup();
      if (!isFinite(d) || d <= 0) reject(new Error("invalid duration"));
      else resolve(d);
    };
    v.onerror = () => {
      clearTimeout(t);
      cleanup();
      reject(new Error("Could not load video metadata"));
    };
    v.src = url;
  });
}

async function probeMp4Duration(file: File): Promise<number> {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (!ext || !["mp4", "m4v", "mov"].includes(ext)) return 0;
  const view = new DataView(await file.arrayBuffer());
  const mvhd = findMp4Box(view, 0, view.byteLength, ["moov", "mvhd"]);
  if (!mvhd) return 0;

  const version = view.getUint8(mvhd.start);
  if (version === 1) {
    const timescale = view.getUint32(mvhd.start + 20);
    const duration = readUint64(view, mvhd.start + 24);
    return timescale ? duration / timescale : 0;
  }

  const timescale = view.getUint32(mvhd.start + 12);
  const duration = view.getUint32(mvhd.start + 16);
  return timescale ? duration / timescale : 0;
}

function findMp4Box(
  view: DataView,
  start: number,
  end: number,
  path: string[],
): { start: number; end: number } | null {
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = view.getUint32(offset);
    const type = readBoxType(view, offset + 4);
    let header = 8;
    let size = size32;

    if (size32 === 1 && offset + 16 <= end) {
      size = Number(readUint64(view, offset + 8));
      header = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }

    if (!size || size < header) break;
    const boxEnd = Math.min(offset + size, end);
    const payloadStart = offset + header;

    if (type === path[0]) {
      if (path.length === 1) return { start: payloadStart, end: boxEnd };
      const found = findMp4Box(view, payloadStart, boxEnd, path.slice(1));
      if (found) return found;
    }

    offset = boxEnd;
  }
  return null;
}

function readBoxType(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function readUint64(view: DataView, offset: number): number {
  const high = view.getUint32(offset);
  const low = view.getUint32(offset + 4);
  return high * 2 ** 32 + low;
}

async function probeDurationWithFFmpeg(ff: FFmpeg, inputName: string): Promise<number> {
  const probeOut = `duration-${Date.now()}.txt`;
  try {
    const code = await ff.ffprobe(
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        inputName,
        "-o",
        probeOut,
      ],
      20_000,
    );
    if (code === 0) {
      const data = await ff.readFile(probeOut, "utf8");
      const parsed = Number(String(data).trim());
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  } catch {
    /* fall through to log parsing */
  } finally {
    try {
      await ff.deleteFile(probeOut);
    } catch {
      /* ignore */
    }
  }

  let dur = 0;
  const handler = ({ message }: { message: string }) => {
    // ffmpeg prints e.g. "  Duration: 00:01:23.45, start: 0.000000, ..."
    const m = message.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (m) {
      dur = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
  };
  ff.on("log", handler);
  try {
    // Running with no output prints container metadata and exits quickly; don't
    // use `-f null -` here because that decodes the whole video.
    await ff.exec(["-hide_banner", "-i", inputName], 20_000).catch(() => {});
  } finally {
    ff.off("log", handler);
  }
  return dur;
}

async function execWithProgress(
  ff: FFmpeg,
  args: string[],
  timeoutMs: number,
  durationSec: number,
  onProgress: (ratio: number) => void,
): Promise<number> {
  let lastTick = 0;
  const handler = ({ progress, time }: { progress?: number; time?: number }) => {
    const now = Date.now();
    if (now - lastTick < 2500) return;
    lastTick = now;

    const byProgress = typeof progress === "number" && Number.isFinite(progress) ? progress : 0;
    const byTime =
      typeof time === "number" && Number.isFinite(time) && durationSec > 0
        ? time / 1_000_000 / durationSec
        : 0;
    const ratio = Math.max(byProgress, byTime);
    if (ratio > 0) onProgress(Math.max(0, Math.min(1, ratio)));
  };

  ff.on("progress", handler);
  try {
    return await ff.exec(args, timeoutMs);
  } finally {
    ff.off("progress", handler);
  }
}

function getClipExtension(mimeType: string): "mp4" | "webm" {
  return mimeType.includes("webm") ? "webm" : "mp4";
}

async function renderClipWithMediaRecorder(
  file: File,
  startSec: number,
  durationSec: number,
  aspectRatio: PipelineConfig["aspect_ratio"],
  onProgress: (ratio: number) => void,
): Promise<Blob> {
  if (typeof MediaRecorder === "undefined") {
    throw new Error("MediaRecorder is unavailable in this browser");
  }

  const mimeType = pickRecorderMimeType();
  const sourceUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Canvas renderer unavailable");

  const width = aspectRatio === "9:16" ? 540 : 720;
  const height = aspectRatio === "9:16" ? 960 : 720;
  canvas.width = width;
  canvas.height = height;
  video.src = sourceUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  try {
    await waitForVideoMetadata(video, 15_000);
    video.currentTime = Math.max(0, startSec);
    await waitForVideoSeek(video, 15_000);

    const stream = canvas.captureStream(24);
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    const endAt = Math.min(video.duration || startSec + durationSec, startSec + durationSec);
    let animationFrame = 0;
    let lastProgress = 0;
    const draw = () => {
      drawVideoCover(ctx, video, width, height);
      const ratio = Math.max(0, Math.min(1, (video.currentTime - startSec) / durationSec));
      if (ratio - lastProgress > 0.03) {
        lastProgress = ratio;
        onProgress(ratio);
      }
      if (!video.paused && !video.ended && video.currentTime < endAt) {
        animationFrame = requestAnimationFrame(draw);
      }
    };

    drawVideoCover(ctx, video, width, height);
    const stopped = new Promise<Blob>((resolve, reject) => {
      recorder.onerror = () => reject(new Error("Recorder failed"));
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || "video/webm";
        const blob = new Blob(chunks, { type });
        blob.size > 0 ? resolve(blob) : reject(new Error("Recorder produced an empty clip"));
      };
    });

    recorder.start(1000);
    await video.play();
    draw();

    await new Promise<void>((resolve) => {
      const stop = () => {
        if (animationFrame) cancelAnimationFrame(animationFrame);
        video.pause();
        if (recorder.state !== "inactive") recorder.stop();
        resolve();
      };
      const timer = window.setTimeout(stop, Math.ceil(durationSec * 1000) + 1500);
      const tick = () => {
        if (video.currentTime >= endAt || video.ended) {
          window.clearTimeout(timer);
          stop();
        } else {
          window.setTimeout(tick, 200);
        }
      };
      tick();
    });

    onProgress(1);
    return await stopped;
  } finally {
    video.pause();
    video.removeAttribute("src");
    URL.revokeObjectURL(sourceUrl);
  }
}

function pickRecorderMimeType(): string {
  const options = [
    "video/webm;codecs=vp8",
    "video/webm",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
  ];
  return options.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function waitForVideoMetadata(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (video.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Video metadata timed out")), timeoutMs);
    video.onloadedmetadata = () => {
      window.clearTimeout(timer);
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("Video could not be loaded for recorder"));
    };
  });
}

function waitForVideoSeek(video: HTMLVideoElement, timeoutMs: number): Promise<void> {
  if (!video.seeking) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Video seek timed out")), timeoutMs);
    video.onseeked = () => {
      window.clearTimeout(timer);
      resolve();
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("Video seek failed"));
    };
  });
}

function drawVideoCover(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
) {
  const sourceWidth = video.videoWidth || width;
  const sourceHeight = video.videoHeight || height;
  const targetAspect = width / height;
  const sourceAspect = sourceWidth / sourceHeight;
  let sx = 0;
  let sy = 0;
  let sw = sourceWidth;
  let sh = sourceHeight;

  if (sourceAspect > targetAspect) {
    sw = sourceHeight * targetAspect;
    sx = (sourceWidth - sw) / 2;
  } else {
    sh = sourceWidth / targetAspect;
    sy = (sourceHeight - sh) / 2;
  }

  ctx.fillStyle = "#0d0d0d";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
