import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { SubmissionPanel } from "@/components/submission-panel";
import { PipelineTerminal } from "@/components/pipeline-terminal";
import { PipelineStages, type PreStage } from "@/components/pipeline-stages";
import { ClipsGrid } from "@/components/clips-grid";
import { Hero } from "@/components/hero";
import { supabase } from "@/integrations/supabase/client";
import type { VideoRow, ClipRow } from "@/lib/autocliper-types";
import { resumeRealPipelineFromStoredSource } from "@/lib/real-pipeline";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "AutoCliper — Dashboard" },
      {
        name: "description",
        content:
          "Submit a YouTube URL or upload a video and AutoCliper will deliver AI-ranked vertical shorts with stylized subtitles.",
      },
    ],
  }),
  component: Dashboard,
});

const DEFAULT_STALL_MS = 3 * 60_000;
const UPLOAD_STALL_MS = 12 * 60_000;
const TRANSCODE_STALL_MS = 8 * 60_000;
const MAX_AUTO_RETRIES = 2;

function Dashboard() {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoRow | null>(null);
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [preStage, setPreStage] = useState<PreStage>({ kind: "idle" });
  const notifiedFailureRef = useRef<string | null>(null);
  const restartRef = useRef<(() => Promise<string>) | null>(null);
  const retryCountRef = useRef(0);
  const retryingRef = useRef(false);
  // Track last observed progress per video to detect stalls
  const stallTrackerRef = useRef<{ videoId: string; progress: number; stage: string; since: number } | null>(null);

  useEffect(() => {
    if (!video) return;
    if (video.status === "failed" && notifiedFailureRef.current !== video.id) {
      notifiedFailureRef.current = video.id;
      const stage = video.stage ?? "pipeline";
      const stageLabel =
        stage === "transcribing"
          ? "Transcription failed"
          : stage === "rendering"
          ? "Rendering failed"
          : stage === "downloading"
          ? "Upload failed"
          : "Pipeline failed";
      toast.error(stageLabel, {
        description: video.error ?? "Something went wrong. Check the terminal log for details.",
      });
    }
    if (video.status === "completed" && notifiedFailureRef.current === video.id) {
      notifiedFailureRef.current = null;
    }
  }, [video]);

  // Auto-retry: if progress is unchanged for STALL_MS while processing, restart.
  useEffect(() => {
    if (!video) return;
    if (video.status !== "processing") {
      stallTrackerRef.current = null;
      return;
    }
    const tracker = stallTrackerRef.current;
    const now = Date.now();
    if (!tracker || tracker.videoId !== video.id) {
      stallTrackerRef.current = { videoId: video.id, progress: video.progress, stage: video.stage, since: now };
      return;
    }
    if (tracker.progress !== video.progress || tracker.stage !== video.stage) {
      stallTrackerRef.current = { videoId: video.id, progress: video.progress, stage: video.stage, since: now };
      return;
    }

    const check = window.setInterval(async () => {
      const t = stallTrackerRef.current;
      if (!t || t.videoId !== video.id) return;
      if (Date.now() - t.since < stallTimeoutForStage(video.stage, video.progress)) return;
      if (retryingRef.current) return;

      // Stalled. Try auto-retry if we can.
      window.clearInterval(check);
      const restart = restartRef.current ?? (() => resumeRealPipelineFromStoredSource(video.id));
      if (retryCountRef.current >= MAX_AUTO_RETRIES) {
        const msg = `Pipeline stalled after ${MAX_AUTO_RETRIES} auto-retries. Please start it again.`;
        await supabase
          .from("videos")
          .update({ status: "failed", stage: "failed", error: msg })
          .eq("id", video.id);
        return;
      }

      retryingRef.current = true;
      retryCountRef.current += 1;
      const attempt = retryCountRef.current;
      toast.warning(`Pipeline stalled at ${Math.round(video.progress)}% · auto-retry ${attempt}/${MAX_AUTO_RETRIES}`);
      try {
        await supabase
          .from("videos")
          .update({
            status: "failed",
            stage: "failed",
            error: `Stalled at ${Math.round(video.progress)}% — auto-retrying (${attempt}/${MAX_AUTO_RETRIES})`,
          })
          .eq("id", video.id);

        const newVideoId = await restart();
        window.localStorage.setItem("autocliper-active-video-id", newVideoId);
        setClips([]);
        setVideo(null);
        setPreStage({ kind: "idle" });
        stallTrackerRef.current = null;
        setActiveVideoId(newVideoId);
      } catch (e) {
        toast.error("Auto-retry failed", {
          description: e instanceof Error ? e.message : "Unknown error",
        });
      } finally {
        retryingRef.current = false;
      }
    }, 5_000);

    return () => window.clearInterval(check);
  }, [video]);

  useEffect(() => {
    const savedVideoId = window.localStorage.getItem("autocliper-active-video-id");
    if (savedVideoId) setActiveVideoId(savedVideoId);
  }, []);

  useEffect(() => {
    if (!activeVideoId) return;
    let cancelled = false;
    let isProcessing = true;

    const load = async () => {
      const { data: v } = await supabase
        .from("videos")
        .select("*")
        .eq("id", activeVideoId)
        .maybeSingle();
      if (!cancelled && v) {
        let nextVideo = v as unknown as VideoRow;
        isProcessing = nextVideo.status === "processing";
        if (isStalledTranscribe(nextVideo)) {
          const stalledError = "This run got stuck while reading video metadata. Please start it again.";
          await supabase
            .from("videos")
            .update({
              status: "failed",
              stage: "failed",
              error: stalledError,
            })
            .eq("id", activeVideoId);
          nextVideo = { ...nextVideo, status: "failed", stage: "failed", error: stalledError };
          isProcessing = false;
        }
        setVideo(nextVideo);
      }

      const { data: c } = await supabase
        .from("clips")
        .select("*")
        .eq("video_id", activeVideoId)
        .order("score", { ascending: false });
      if (!cancelled && c) setClips(c as unknown as ClipRow[]);
    };
    load();

    const poll = window.setInterval(() => {
      if (isProcessing) void load();
    }, 1500);

    const channel = supabase
      .channel(`video:${activeVideoId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "videos", filter: `id=eq.${activeVideoId}` },
        (payload) => {
          if (payload.new) setVideo(payload.new as unknown as VideoRow);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "clips", filter: `video_id=eq.${activeVideoId}` },
        () => load(),
      )
      .subscribe();

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      supabase.removeChannel(channel);
    };
  }, [activeVideoId]);

  const handleJobStarted = ({ videoId, restart }: { videoId: string; restart: () => Promise<string> }) => {
    window.localStorage.setItem("autocliper-active-video-id", videoId);
    setClips([]);
    setVideo(null);
    setPreStage({ kind: "idle" });
    restartRef.current = restart;
    retryCountRef.current = 0;
    retryingRef.current = false;
    stallTrackerRef.current = null;
    setActiveVideoId(videoId);
  };

  return (
    <main className="mx-auto max-w-7xl px-6 py-12 md:px-12">
      <Hero />

      <section className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-12">
        <div className="md:col-span-8">
          <SubmissionPanel
            onJobStarted={handleJobStarted}
            onPreStageChange={setPreStage}
            disabled={video?.status === "processing"}
          />
        </div>
        <div className="md:col-span-4">
          <PipelineStages video={video} preStage={preStage} />
        </div>
        <div className="md:col-span-12">
          <PipelineTerminal video={video} />
        </div>
      </section>

      <section className="mt-12">
        <ClipsGrid video={video} clips={clips} />
      </section>

      <footer className="mt-20 flex flex-col gap-2 border-t border-[color:var(--color-ink)]/10 pt-6 text-[10px] uppercase tracking-[0.28em] text-foreground/45 md:flex-row md:items-center md:justify-between">
        <span className="font-mono">© MMXXVI · AutoCliper</span>
        <span className="font-display text-sm italic normal-case tracking-normal text-foreground/55">
          Refinement Variant 04
        </span>
      </footer>
    </main>
  );
}

function isStalledTranscribe(video: VideoRow): boolean {
  if (video.status !== "processing" || video.stage !== "transcribing") return false;
  if (video.progress > 40) return false;
  const updatedAt = new Date(video.updated_at).getTime();
  if (!Number.isFinite(updatedAt)) return false;
  return Date.now() - updatedAt > 10 * 60 * 1000;
}

function stallTimeoutForStage(stage: VideoRow["stage"], progress: number): number {
  if (stage === "downloading" || progress <= 20) return UPLOAD_STALL_MS;
  if (stage === "transcribing") return TRANSCODE_STALL_MS;
  return DEFAULT_STALL_MS;
}
