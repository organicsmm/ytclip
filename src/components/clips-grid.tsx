import type { ClipRow, VideoRow } from "@/lib/skate-types";
import { Download, Sparkles, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Props {
  video: VideoRow | null;
  clips: ClipRow[];
}

export function ClipsGrid({ video, clips }: Props) {
  if (!video) {
    return (
      <div className="glass-card rounded-2xl p-12 text-center">
        <Sparkles className="mx-auto h-10 w-10 text-primary/60" />
        <h3 className="mt-4 font-display text-xl font-semibold">Your shorts will appear here</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Generated clips show up live as the AI selects them.
        </p>
      </div>
    );
  }

  if (clips.length === 0 && video.status === "processing") {
    return (
      <div>
        <SectionHeader video={video} />
        <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="glass-card aspect-[9/16] animate-pulse rounded-2xl"
              style={{ animationDelay: `${i * 120}ms` }}
            />
          ))}
        </div>
      </div>
    );
  }

  if (clips.length === 0) {
    return null;
  }

  return (
    <div>
      <SectionHeader video={video} count={clips.length} />
      <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {clips.map((c) => (
          <ClipCard key={c.id} clip={c} />
        ))}
      </div>
    </div>
  );
}

function SectionHeader({ video, count }: { video: VideoRow; count?: number }) {
  return (
    <div className="flex items-end justify-between">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">
          step 03 · results
        </p>
        <h2 className="mt-1 font-display text-3xl font-bold text-gradient">
          {video.title}
        </h2>
        {count !== undefined && (
          <p className="mt-1 text-sm text-muted-foreground">
            {count} viral shorts generated, ranked by AI engagement score.
          </p>
        )}
      </div>
    </div>
  );
}

function ClipCard({ clip }: { clip: ClipRow }) {
  const duration = clip.end_time - clip.start_time;
  return (
    <article className="glass-card group flex flex-col overflow-hidden rounded-2xl transition-all hover:border-primary/40 hover:shadow-glow-sm">
      <div
        className={`relative w-full overflow-hidden bg-black ${
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
          <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-primary/20 to-primary-glow/10 text-center">
            <Sparkles className="h-8 w-8 text-primary" />
            <p className="mt-2 px-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              rendered short preview
            </p>
          </div>
        )}
        <div className="absolute right-2 top-2">
          <Badge className="border-primary/40 bg-background/80 font-mono text-[10px] backdrop-blur">
            Score {Math.round(clip.score)}%
          </Badge>
        </div>
        <div className="absolute bottom-2 left-2">
          <Badge variant="outline" className="border-border/60 bg-background/80 font-mono text-[10px] backdrop-blur">
            <Clock className="mr-1 h-2.5 w-2.5" />
            {formatTime(clip.start_time)} → {formatTime(clip.end_time)} · {duration.toFixed(0)}s
          </Badge>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h3 className="line-clamp-2 font-display text-base font-semibold">{clip.title}</h3>
        {clip.hook && (
          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">"{clip.hook}"</p>
        )}
        {clip.hashtags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {clip.hashtags.slice(0, 4).map((h) => (
              <span
                key={h}
                className="rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary"
              >
                {h.startsWith("#") ? h : `#${h}`}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 flex-1" />
        <Button
          asChild={!!clip.video_url}
          variant="secondary"
          className="mt-2 w-full bg-primary/15 text-foreground hover:bg-primary/25"
          disabled={!clip.video_url}
        >
          {clip.video_url ? (
            <a href={clip.video_url} download>
              <Download className="mr-2 h-4 w-4" /> Download MP4
            </a>
          ) : (
            <span>
              <Download className="mr-2 h-4 w-4" /> Rendering…
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
