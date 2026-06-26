/**
 * Mock pipeline for v1 — runs entirely client-side using the public Supabase
 * client and writes the same DB rows the real pipeline will (videos + clips).
 *
 * Replace this with a server-side orchestrator that calls Replicate (or any
 * external worker) for transcription, ranking, and FFmpeg rendering. The DB
 * shape and Realtime channels stay identical so the UI doesn't change.
 */
import { supabase } from "@/integrations/supabase/client";
import type { PipelineConfig, VideoStage } from "@/lib/skate-types";

interface StartParams {
  title: string;
  source_url: string | null;
  source_type: "youtube" | "upload";
  config: PipelineConfig;
}

const SAMPLE_CLIPS = [
  {
    title: "The one mindset shift that changed everything",
    hook: "If you only watch one minute of this, watch this one — it reframes how you think about leverage.",
    hashtags: ["#mindset", "#leverage", "#productivity", "#growth"],
    score: 96,
    start_time: 142,
    end_time: 198,
  },
  {
    title: "Why most people stay stuck for years",
    hook: "It's not what you're doing wrong — it's what you keep tolerating that quietly costs you everything.",
    hashtags: ["#selfimprovement", "#mindset", "#truth", "#viral"],
    score: 91,
    start_time: 387,
    end_time: 441,
  },
  {
    title: "The 60-second framework nobody teaches",
    hook: "I tested this framework with 100 students. The ones who used it shipped 4x faster.",
    hashtags: ["#framework", "#startup", "#advice", "#mustwatch"],
    score: 88,
    start_time: 612,
    end_time: 668,
  },
  {
    title: "What every successful founder gets right early",
    hook: "Forget what you've heard. The single trait that separates winners is way simpler — and harder.",
    hashtags: ["#founder", "#startup", "#advice", "#business"],
    score: 84,
    start_time: 821,
    end_time: 879,
  },
  {
    title: "The brutal truth about overnight success",
    hook: "Most 'overnight successes' grinded for 7 years in silence. Here's what that actually looks like.",
    hashtags: ["#truth", "#hustle", "#realtalk", "#mindset"],
    score: 79,
    start_time: 1054,
    end_time: 1110,
  },
];

export async function startMockPipeline(params: StartParams): Promise<string> {
  const { data, error } = await supabase
    .from("videos")
    .insert({
      title: params.title,
      source_url: params.source_url,
      source_type: params.source_type,
      status: "processing",
      stage: "queued",
      progress: 0,
      log_lines: ["[INIT] Skate pipeline starting…"],
      config: params.config as never,
    })
    .select("id")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Failed to create video row");
  const videoId = data.id;

  // Fire-and-forget the mock job; updates stream to UI via Realtime.
  runMockJob(videoId, params).catch(async (err) => {
    console.error(err);
    await supabase
      .from("videos")
      .update({ status: "failed", stage: "failed", error: String(err) })
      .eq("id", videoId);
  });

  return videoId;
}

async function runMockJob(videoId: string, params: StartParams) {
  const log: string[] = ["[INIT] Skate pipeline starting…"];
  const append = async (line: string, patch: { stage?: VideoStage; progress?: number } = {}) => {
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
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Stage 1: download
  await append(`[01] Source: ${params.source_url ?? "uploaded file"}`, {
    stage: "downloading",
    progress: 5,
  });
  for (const p of [15, 28, 42, 60]) {
    await sleep(500);
    await append(`📥 Downloading video… ${p}%`, { progress: p });
  }
  await append("✅ Download complete (98.4 MB)", { progress: 65 });

  // Stage 2: transcribe
  await append("🎙️  Transcribing audio with Whisper (large-v3)…", {
    stage: "transcribing",
    progress: 68,
  });
  await sleep(900);
  await append("   detected language: en  ·  segments: 312", { progress: 75 });

  // Stage 3: chunk + score
  await append("🧠 Chunking transcript into 28 candidates…", { stage: "chunking", progress: 78 });
  await sleep(600);
  await append("   sending chunks to LLM for engagement scoring…", { progress: 82 });
  await sleep(800);

  // Stage 4: select top clips
  await append("🏆 Top 5 clips selected:", { stage: "selecting", progress: 86 });
  for (const c of SAMPLE_CLIPS) {
    await append(`   • [${fmtTime(c.start_time)}–${fmtTime(c.end_time)}]  ${c.score}%  ${c.title}`);
    await sleep(160);
  }

  // Stage 5: render — insert clip rows progressively
  await append("✂️  Rendering vertical crops & burning subtitles…", {
    stage: "rendering",
    progress: 90,
  });

  for (let i = 0; i < SAMPLE_CLIPS.length; i++) {
    const c = SAMPLE_CLIPS[i];
    await sleep(700);
    const pct = 90 + Math.round(((i + 1) / SAMPLE_CLIPS.length) * 9);
    await append(`   rendering clip ${i + 1}/${SAMPLE_CLIPS.length} (${c.title.slice(0, 38)}…)`, {
      progress: pct,
    });
    await supabase.from("clips").insert({
      video_id: videoId,
      title: c.title,
      start_time: c.start_time,
      end_time: c.end_time,
      score: c.score,
      hook: c.hook,
      hashtags: c.hashtags,
      aspect_ratio: params.config.aspect_ratio,
      // No real render yet — UI shows a "rendered preview" placeholder.
      video_url: null,
    });
  }

  await append("🎉 Pipeline complete · 5 viral shorts ready", { progress: 100 });
  await supabase
    .from("videos")
    .update({ status: "completed", stage: "completed", progress: 100, log_lines: log })
    .eq("id", videoId);
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
