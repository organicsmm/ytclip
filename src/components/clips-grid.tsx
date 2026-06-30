import type { ClipRow, VideoRow } from "@/lib/autocliper-types";
import { Download, Clock, Loader2, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { probeAudio } from "@/lib/audio-probe";


/** Extract the storage object path from a Supabase signed/public URL for the `clips` bucket. */
function extractClipsPath(url: string): string | null {
  try {
    const u = new URL(url);
    // Signed:  /storage/v1/object/sign/clips/<path>?token=...
    // Public:  /storage/v1/object/public/clips/<path>
    // Auth:    /storage/v1/object/authenticated/clips/<path>
    const m = u.pathname.match(/\/storage\/v1\/object\/(?:sign|public|authenticated)\/clips\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  } catch {
    return null;
  }
}

async function downloadClip(clip: ClipRow): Promise<void> {
  if (!clip.video_url) {
    toast.info("Still rendering", {
      description: "Hang tight — this clip will be ready in a moment.",
    });
    return;
  }
  const path = extractClipsPath(clip.video_url);
  if (!path) {
    // Fallback: best-effort direct link
    window.open(clip.video_url, "_blank", "noopener");
    return;
  }

  // Mint a fresh short-lived signed URL each click (the stored one may have expired).
  const { data: signed, error: signErr } = await supabase.storage
    .from("clips")
    .createSignedUrl(path, 60 * 10);

  if (signErr || !signed?.signedUrl) {
    toast.error("Couldn't generate download link", {
      description: signErr?.message ?? "You may need to sign back in.",
    });
    return;
  }

  // Fetch as blob so the browser saves the file rather than navigating.
  try {
    const res = await fetch(signed.signedUrl);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();

    // Verify audio stream is present before handing the file to the user.
    const probe = await probeAudio(blob);
    if (!probe.hasAudio) {
      toast.warning("Clip has no audio", {
        description:
          "The downloaded file appears to be silent (no audio stream detected). Try re-rendering the clip.",
        duration: 8000,
      });
    } else {
      toast.success("Audio verified", {
        description: probe.codec
          ? `Audio stream OK (${probe.codec}).`
          : "Audio stream OK.",
      });
    }

    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    const safe = clip.title.replace(/[^\w\s-]/g, "").trim().slice(0, 60) || "clip";
    const ext = getDownloadExtension(blob.type, path);
    a.download = `${safe}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5_000);
  } catch (e) {
    toast.error("Download failed", {
      description: e instanceof Error ? e.message : "Try again in a moment.",
    });
  }
}


function getDownloadExtension(mimeType: string, path: string): "mp4" | "webm" {
  const type = mimeType.toLowerCase();
  if (type.includes("webm")) return "webm";
  if (type.includes("mp4")) return "mp4";
  return path.toLowerCase().endsWith(".webm") ? "webm" : "mp4";
}

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
  const [downloading, setDownloading] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ready = !!clip.video_url;

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadClip(clip);
    } finally {
      setDownloading(false);
    }
  };

  const toggleMute = async () => {
    const v = videoRef.current;
    if (!v) return;
    const next = !muted;
    v.muted = next;
    setMuted(next);
    if (!next) {
      v.volume = 1;
      try { await v.play(); } catch { /* ignore */ }
    }
  };

  return (
    <article className="paper-card group flex flex-col overflow-hidden transition-colors hover:border-[color:var(--color-ink)]/30">
      <div
        className={`relative w-full overflow-hidden bg-[#0d0d0d] ${
          clip.aspect_ratio === "1:1" ? "aspect-square" : "aspect-[9/16]"
        }`}
      >
        {clip.video_url ? (
          <video
            ref={videoRef}
            src={clip.video_url}
            controls
            autoPlay
            muted={muted}
            loop
            playsInline
            preload="auto"
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
        {ready && (
          <button
            type="button"
            onClick={toggleMute}
            aria-label={muted ? "Unmute clip" : "Mute clip"}
            className="absolute left-3 top-3 inline-flex items-center gap-1.5 bg-[#0d0d0d]/85 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#f5f3ee] hover:bg-[#0d0d0d]"
          >
            {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
            {muted ? "Tap for sound" : "Sound on"}
          </button>
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
          type="button"
          onClick={handleDownload}
          className="btn-glow mt-3 h-11 w-full rounded-none text-[10px] font-semibold uppercase tracking-[0.28em]"
          disabled={!ready || downloading}
          title={ready ? "Download clip" : "Clip is still rendering — try again in a moment"}
        >
          {downloading ? (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Preparing…
            </>
          ) : ready ? (
            <>
              <Download className="mr-2 h-3.5 w-3.5" /> Download Clip
            </>
          ) : (
            <>
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Rendering…
            </>
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
