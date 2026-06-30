import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SubmissionPanel } from "@/components/submission-panel";
import { PipelineTerminal } from "@/components/pipeline-terminal";
import { PipelineStages, type PreStage } from "@/components/pipeline-stages";
import { ClipsGrid } from "@/components/clips-grid";
import { Hero } from "@/components/hero";
import { supabase } from "@/integrations/supabase/client";
import type { VideoRow, ClipRow } from "@/lib/skate-types";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Skate AI — Dashboard" },
      {
        name: "description",
        content:
          "Submit a YouTube URL or upload a video and Skate AI will deliver AI-ranked vertical shorts with stylized subtitles.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [video, setVideo] = useState<VideoRow | null>(null);
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [preStage, setPreStage] = useState<PreStage>({ kind: "idle" });

  useEffect(() => {
    const savedVideoId = window.localStorage.getItem("skate-active-video-id");
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
        const nextVideo = v as unknown as VideoRow;
        isProcessing = nextVideo.status === "processing";
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

  const handleJobStarted = (videoId: string) => {
    window.localStorage.setItem("skate-active-video-id", videoId);
    setClips([]);
    setVideo(null);
    setPreStage({ kind: "idle" });
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
        <span className="font-mono">© MMXXVI · Skate Artificial Intelligence</span>
        <span className="font-display text-sm italic normal-case tracking-normal text-foreground/55">
          Refinement Variant 04
        </span>
      </footer>
    </main>
  );
}
