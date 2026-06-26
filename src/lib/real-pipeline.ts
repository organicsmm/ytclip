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
import { generateClipSuggestions } from "@/lib/ai.functions";
import type { PipelineConfig, VideoStage } from "@/lib/skate-types";

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
  const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd";
  await ff.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
  });
  ffmpegSingleton = ff;
  return ff;
}

export async function startRealPipeline(params: StartParams): Promise<string> {
  // 1. Insert video row
  const { data: inserted, error: insertErr } = await supabase
    .from("videos")
    .insert({
      title: params.title,
      source_url: null,
      source_type: "upload",
      status: "processing",
      stage: "queued",
      progress: 0,
      log_lines: ["[INIT] Skate pipeline starting…"],
      config: params.config as never,
    })
    .select("id")
    .single();
  if (insertErr || !inserted) throw new Error(insertErr?.message ?? "Failed to create video row");
  const videoId = inserted.id;

  // fire and forget
  runPipeline(videoId, params).catch(async (err) => {
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

async function runPipeline(videoId: string, params: StartParams) {
  const log: string[] = ["[INIT] Skate pipeline starting…"];
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
  const sourceKey = `${videoId}/source.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("uploads")
    .upload(sourceKey, params.file, { upsert: true, contentType: params.file.type || "video/mp4" });
  if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
  await push("✅ Source uploaded to Lovable Cloud storage", { progress: 20 });

  // 2. Load ffmpeg + probe duration
  await push("🛠️  Loading ffmpeg.wasm in the browser…", {
    stage: "transcribing",
    progress: 28,
  });
  const ff = await getFFmpeg();
  await push("   ffmpeg ready", { progress: 35 });

  const inputName = `in.${ext}`;
  await ff.writeFile(inputName, await fetchFile(params.file));

  const duration = await probeDuration(params.file);
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

  const cropFilter =
    params.config.aspect_ratio === "9:16"
      ? "crop=ih*9/16:ih,scale=1080:1920:flags=lanczos"
      : "crop=ih:ih,scale=1080:1080:flags=lanczos";

  for (let i = 0; i < suggestions.length; i++) {
    const c = suggestions[i];
    const outName = `clip_${i}.mp4`;
    const startStr = c.start_time.toString();
    const dur = (c.end_time - c.start_time).toString();

    await push(`   rendering ${i + 1}/${suggestions.length} · ${c.title.slice(0, 40)}…`);

    await ff.exec([
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
      "-crf",
      "26",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outName,
    ]);

    const fileData = (await ff.readFile(outName)) as Uint8Array;
    const blob = new Blob([fileData as BlobPart], { type: "video/mp4" });
    const clipKey = `${videoId}/clip_${i}.mp4`;
    const { error: clipUpErr } = await supabase.storage
      .from("clips")
      .upload(clipKey, blob, { upsert: true, contentType: "video/mp4" });
    if (clipUpErr) throw new Error(`Clip upload failed: ${clipUpErr.message}`);

    const { data: signed } = await supabase.storage
      .from("clips")
      .createSignedUrl(clipKey, 60 * 60 * 24 * 7);

    await supabase.from("clips").insert({
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

  try {
    await ff.deleteFile(inputName);
  } catch {
    /* ignore */
  }

  await push("🎉 Pipeline complete · clips ready to download", { progress: 100 });
  await supabase
    .from("videos")
    .update({ status: "completed", stage: "completed", progress: 100, log_lines: log })
    .eq("id", videoId);
}

function probeDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.src = url;
    v.onloadedmetadata = () => {
      const d = v.duration;
      URL.revokeObjectURL(url);
      if (!isFinite(d) || d <= 0) reject(new Error("Could not read video duration"));
      else resolve(d);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load video metadata"));
    };
  });
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
