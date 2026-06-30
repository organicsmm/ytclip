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

  // Subscribe to the active video + its clips
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
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Hero />

      <section className="mt-12 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SubmissionPanel
            onJobStarted={handleJobStarted}
            onPreStageChange={setPreStage}
            disabled={video?.status === "processing"}
          />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-2">
          <PipelineStages video={video} preStage={preStage} />
          <PipelineTerminal video={video} />
        </div>
      </section>

      <section className="mt-12">
        <ClipsGrid video={video} clips={clips} />
      </section>
    </main>
  );
}
