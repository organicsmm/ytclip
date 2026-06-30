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
import { fetchFile, toBlobURL } from "@ffmpeg/util";
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
    await push("   browser couldn't read metadata, probing with ffprobe…", { progress: 38 });
  }
  if (!duration || !isFinite(duration)) {
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

  // 720p output renders ~2-3x faster than 1080p in ffmpeg.wasm and still looks
  // crisp on TikTok/Reels/Shorts (which re-encode uploads anyway).
  const cropFilter =
    params.config.aspect_ratio === "9:16"
      ? "crop=ih*9/16:ih,scale=720:1280:flags=fast_bilinear"
      : "crop=ih:ih,scale=720:720:flags=fast_bilinear";

  for (let i = 0; i < suggestions.length; i++) {
    const c = suggestions[i];
    const outName = `clip_${i}.mp4`;
    const startStr = c.start_time.toString();
    const dur = (c.end_time - c.start_time).toString();

    await push(`   rendering ${i + 1}/${suggestions.length} · ${c.title.slice(0, 40)}…`);

    const exitCode = await ff.exec([
      "-ss",
      startStr,
      "-i",
      inputName,
      "-t",
      dur,
      "-vf",
      cropFilter,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-tune",
      "fastdecode,zerolatency",
      "-crf",
      "28",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "60",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      "-threads",
      "0",
      outName,
    ], 300_000);
    if (exitCode !== 0) {
      throw new Error(`Clip ${i + 1} render timed out or failed`);
    }

    const fileData = (await ff.readFile(outName)) as Uint8Array;
    const blob = new Blob([fileData as BlobPart], { type: "video/mp4" });
    const clipKey = `${userId}/${videoId}/clip_${i}.mp4`;
    const { error: clipUpErr } = await supabase.storage
      .from("clips")
      .upload(clipKey, blob, { upsert: true, contentType: "video/mp4" });
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
      end_time: c.end_time,
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
    await push(`   ✅ clip ${i + 1} uploaded`, { progress: pct });
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

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
