import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { SubmissionPanel } from "@/components/submission-panel";
import { PipelineTerminal } from "@/components/pipeline-terminal";
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

  // Subscribe to the active video + its clips
  useEffect(() => {
    if (!activeVideoId) return;
    let cancelled = false;

    const load = async () => {
      const { data: v } = await supabase
        .from("videos")
        .select("*")
        .eq("id", activeVideoId)
        .maybeSingle();
      if (!cancelled && v) setVideo(v as VideoRow);

      const { data: c } = await supabase
        .from("clips")
        .select("*")
        .eq("video_id", activeVideoId)
        .order("score", { ascending: false });
      if (!cancelled && c) setClips(c as ClipRow[]);
    };
    load();

    const channel = supabase
      .channel(`video:${activeVideoId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "videos", filter: `id=eq.${activeVideoId}` },
        (payload) => {
          if (payload.new) setVideo(payload.new as VideoRow);
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
      supabase.removeChannel(channel);
    };
  }, [activeVideoId]);

  return (
    <main className="mx-auto max-w-7xl px-6 py-10">
      <Hero />

      <section className="mt-12 grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SubmissionPanel onJobStarted={setActiveVideoId} disabled={video?.status === "processing"} />
        </div>
        <div className="lg:col-span-2">
          <PipelineTerminal video={video} />
        </div>
      </section>

      <section className="mt-12">
        <ClipsGrid video={video} clips={clips} />
      </section>
    </main>
  );
}
