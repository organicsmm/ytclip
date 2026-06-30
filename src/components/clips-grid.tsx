import type { ClipRow, VideoRow } from "@/lib/autocliper-types";
import { Download, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  video: VideoRow | null;
  clips: ClipRow[];
}

export function ClipsGrid({ video, clips }: Props) {
  if (!video) {
    return (
      <div>
        <SectionHeader title="Refined Clips" count={0} />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="paper-card flex aspect-[9/16] flex-col items-center justify-center text-center"
            >
              <div className="h-px w-10 bg-[color:var(--color-ink)]/20" />
              <span className="mt-3 font-mono text-[10px] uppercase tracking-[0.28em] text-foreground/35">
                Pending Data
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (clips.length === 0 && video.status === "processing") {
    return (
      <div>
        <SectionHeader title={video.title} subtitle="Processing source material…" />
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="paper-card aspect-[9/16] animate-pulse"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (clips.length === 0) return null;

  return (
    <div>
      <SectionHeader title={video.title} count={clips.length} />
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clips.map((c) => (
          <ClipCard key={c.id} clip={c} />
        ))}
      </div>
    </div>
  );
}

function SectionHeader({
  title,
  count,
  subtitle,
}: {
  title: string;
  count?: number;
  subtitle?: string;
}) {
  return (
    <div className="flex items-end justify-between border-b border-[color:var(--color-ink)]/10 pb-5">
      <div>
        <p className="eyebrow">Step 03 · Results</p>
        <h2 className="mt-2 font-display text-4xl italic leading-none text-[color:var(--color-ink)] md:text-5xl">
          {title}
        </h2>
        {subtitle && <p className="mt-2 text-sm text-foreground/60">{subtitle}</p>}
      </div>
      {count !== undefined && (
        <span className="font-mono text-[10px] uppercase tracking-[0.28em] text-foreground/45">
          {String(count).padStart(2, "0")} Clips Ranked
        </span>
      )}
    </div>
  );
}

function ClipCard({ clip }: { clip: ClipRow }) {
  const duration = clip.end_time - clip.start_time;
  return (
    <article className="paper-card group flex flex-col overflow-hidden transition-colors hover:border-[color:var(--color-ink)]/30">
      <div
        className={`relative w-full overflow-hidden bg-[#0d0d0d] ${
          clip.aspect_ratio === "1:1" ? "aspect-square" : "aspect-[9/16]"
        }`}
      >
        {clip.video_url ? (
          <video
            src={clip.video_url}
            controls
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center bg-[color:var(--color-surface)] text-center">
            <div className="h-px w-10 bg-[color:var(--color-ink)]/20" />
            <span className="mt-3 font-mono text-[10px] uppercase tracking-[0.28em] text-foreground/45">
              Rendering Preview
            </span>
          </div>
        )}
        <div className="absolute right-3 top-3 bg-[#0d0d0d] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#f5f3ee]">
          Score {Math.round(clip.score)}
        </div>
        <div className="absolute bottom-3 left-3 inline-flex items-center gap-1.5 bg-[#0d0d0d]/85 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#f5f3ee]">
          <Clock className="h-2.5 w-2.5" />
          {formatTime(clip.start_time)}–{formatTime(clip.end_time)} · {duration.toFixed(0)}s
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="line-clamp-2 font-display text-xl italic leading-tight text-[color:var(--color-ink)]">
          {clip.title}
        </h3>
        {clip.hook && (
          <p className="mt-3 line-clamp-3 text-sm leading-relaxed text-foreground/70">
            “{clip.hook}”
          </p>
        )}
        {clip.hashtags.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {clip.hashtags.slice(0, 4).map((h) => (
              <span
                key={h}
                className="border border-[color:var(--color-ink)]/15 bg-[color:var(--color-paper)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-foreground/70"
              >
                {h.startsWith("#") ? h : `#${h}`}
              </span>
            ))}
          </div>
        )}
        <div className="mt-5 flex-1" />
        <Button
          asChild={!!clip.video_url}
          className="btn-glow mt-3 h-11 w-full rounded-none text-[10px] font-semibold uppercase tracking-[0.28em]"
          disabled={!clip.video_url}
        >
          {clip.video_url ? (
            <a href={clip.video_url} download>
              <Download className="mr-2 h-3.5 w-3.5" /> Download MP4
            </a>
          ) : (
            <span>
              <Download className="mr-2 h-3.5 w-3.5" /> Rendering…
            </span>
          )}
        </Button>
      </div>
    </article>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
