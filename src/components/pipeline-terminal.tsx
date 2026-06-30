import { useEffect, useRef } from "react";
import type { VideoRow } from "@/lib/skate-types";
import { Progress } from "@/components/ui/progress";

interface Props {
  video: VideoRow | null;
}

const STAGE_LABEL: Record<string, string> = {
  queued: "Queued",
  downloading: "Downloading video",
  transcribing: "Transcribing audio",
  chunking: "Chunking transcript",
  selecting: "AI clip selection",
  rendering: "Rendering & burning subtitles",
  completed: "Complete",
  failed: "Failed",
};

export function PipelineTerminal({ video }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [video?.log_lines]);

  const lines = video?.log_lines ?? [];

  return (
    <div className="flex h-full min-h-[320px] flex-col overflow-hidden bg-[#0d0d0d] text-[#e8e4dd]">
      <div className="flex items-center justify-between border-b border-[#e8e4dd]/15 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-[#e8e4dd]/50">
            System Log
          </span>
          <span className="font-mono text-[10px] text-[#e8e4dd]/30">0x4f2a · skate-pipeline.log</span>
        </div>
        {video && (
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-emerald-400">
            {STAGE_LABEL[video.stage] ?? video.stage}
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-auto px-6 py-4 font-mono text-[11.5px] leading-relaxed text-[#e8e4dd]/85"
      >
        {!video ? (
          <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
            <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
              awaiting input
            </span>
            <p className="mt-3 max-w-xs text-sm">
              Submit a video to stream live progress here.
            </p>
          </div>
        ) : (
          <>
            {lines.map((line, i) => (
              <div key={i} className="flex gap-3">
                <span className="select-none text-muted-foreground/40">
                  {String(i + 1).padStart(3, "0")}
                </span>
                <span className="flex-1 whitespace-pre-wrap text-foreground/90">{line}</span>
              </div>
            ))}
            {video.status === "processing" && (
              <div className="mt-2 flex gap-3">
                <span className="select-none text-muted-foreground/40">
                  {String(lines.length + 1).padStart(3, "0")}
                </span>
                <span className="text-primary">
                  <span className="pulse-dot inline-block">▋</span>
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {video && (
        <div className="border-t border-border/60 bg-surface/40 px-5 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono text-muted-foreground">
              progress · {Math.round(video.progress)}%
            </span>
            <span
              className={`font-mono uppercase tracking-wider ${
                video.status === "completed"
                  ? "text-success"
                  : video.status === "failed"
                    ? "text-destructive"
                    : "text-warning"
              }`}
            >
              {video.status}
            </span>
          </div>
          <Progress value={video.progress} className="mt-2 h-1.5 bg-surface" />
        </div>
      )}
    </div>
  );
}
