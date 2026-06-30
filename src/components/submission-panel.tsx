import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Link2, Upload, Sparkles, Loader2, AlertTriangle, ExternalLink, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { startRealPipeline } from "@/lib/real-pipeline";
import type { PipelineConfig } from "@/lib/skate-types";
import type { PreStage } from "@/components/pipeline-stages";

interface Props {
  onJobStarted: (videoId: string) => void;
  onPreStageChange?: (s: PreStage) => void;
  disabled?: boolean;
}

export function SubmissionPanel({ onJobStarted, onPreStageChange, disabled }: Props) {
  const [tab, setTab] = useState<"youtube" | "upload">("youtube");
  const [file, setFile] = useState<File | null>(null);
  const [ytUrl, setYtUrl] = useState("");
  const [ytStatus, setYtStatus] = useState<string | null>(null);
  const [aspect, setAspect] = useState<PipelineConfig["aspect_ratio"]>("9:16");
  const [subStyle, setSubStyle] = useState<PipelineConfig["subtitle_style"]>("tiktok");
  const [faceTracking, setFaceTracking] = useState(false);
  const [clipCount, setClipCount] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);

  const fetchYouTube = async (): Promise<{ file: File; title: string }> => {
    setYtStatus("Resolving YouTube video…");
    onPreStageChange?.({ kind: "resolving" });
    const resolveRes = await fetch(`/api/public/yt-resolve?url=${encodeURIComponent(ytUrl)}`);
    const meta = (await resolveRes.json().catch(() => ({}))) as {
      title?: string;
      streamUrl?: string;
      mimeType?: string;
      durationSec?: number;
      error?: string;
    };
    if (!resolveRes.ok || meta.error || !meta.streamUrl) {
      throw new Error(meta.error || `Resolve failed (${resolveRes.status})`);
    }
    const title = meta.title || "YouTube video";
    setYtStatus(`Downloading "${title}"…`);
    onPreStageChange?.({ kind: "downloading", loaded: 0, total: 0 });
    const proxied = `/api/public/yt-proxy?u=${encodeURIComponent(meta.streamUrl)}`;
    const dl = await fetch(proxied);
    if (!dl.ok || !dl.body) throw new Error(`Download failed (${dl.status})`);

    const total = Number(dl.headers.get("content-length") ?? 0);
    const reader = dl.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    let lastTick = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      const now = Date.now();
      if (now - lastTick > 150) {
        lastTick = now;
        const pctTxt = total
          ? ` (${Math.round((loaded / total) * 100)}%)`
          : "";
        setYtStatus(`Downloading "${title}"…${pctTxt}`);
        onPreStageChange?.({ kind: "downloading", loaded, total });
      }
    }
    onPreStageChange?.({ kind: "downloading", loaded, total });
    const blob = new Blob(chunks as BlobPart[], { type: meta.mimeType || "video/mp4" });
    const safeName = title.replace(/[^\w\s-]/g, "").slice(0, 60) || "youtube-video";
    const file = new File([blob], `${safeName}.mp4`, { type: meta.mimeType || "video/mp4" });
    setYtStatus(null);
    onPreStageChange?.({ kind: "uploading" });
    return { file, title };
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setYtError(null);
    try {
      let sourceFile: File | null = file;
      let title = file?.name.replace(/\.[^.]+$/, "") ?? "";

      if (tab === "youtube") {
        if (!ytUrl.trim()) {
          toast.error("Paste a YouTube URL first");
          return;
        }
        try {
          const fetched = await fetchYouTube();
          sourceFile = fetched.file;
          title = fetched.title;
        } catch (e) {
          const message = e instanceof Error ? e.message : "YouTube fetch failed";
          setYtError(message);
          return;
        }
      } else if (!sourceFile) {
        toast.error("Choose a video file to upload");
        return;
      }

      const videoId = await startRealPipeline({
        file: sourceFile!,
        title,
        clipCount,
        config: {
          aspect_ratio: aspect,
          subtitle_style: subStyle,
          face_tracking: faceTracking,
        },
      });

      onJobStarted(videoId);
      toast.success("Pipeline started", {
        description: "ffmpeg.wasm is rendering your clips locally.",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to start pipeline";
      toast.error(message);
    } finally {
      setSubmitting(false);
      setYtStatus(null);
    }
  };

  const switchToUpload = () => {
    setTab("upload");
    setYtError(null);
    setYtStatus(null);
    onPreStageChange?.({ kind: "idle" });
  };

  const ytVideoId = (() => {
    try {
      const u = new URL(ytUrl);
      if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || "";
      return u.searchParams.get("v") ?? "";
    } catch {
      return "";
    }
  })();

  return (
    <div className="glass-card rounded-2xl p-6 sm:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-primary">step 01</p>
          <h2 className="mt-1 font-display text-2xl font-semibold">Submit your video</h2>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "youtube" | "upload")}>
        <TabsList className="grid w-full grid-cols-2 bg-surface/60">
          <TabsTrigger value="youtube" className="gap-2">
            <Link2 className="h-3.5 w-3.5" /> YouTube Link
          </TabsTrigger>
          <TabsTrigger value="upload" className="gap-2">
            <Upload className="h-3.5 w-3.5" /> Local Upload
          </TabsTrigger>
        </TabsList>

        <TabsContent value="youtube" className="mt-5">
          <Label htmlFor="yt" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            YouTube URL
          </Label>
          <Input
            id="yt"
            type="url"
            placeholder="https://www.youtube.com/watch?v=…"
            value={ytUrl}
            onChange={(e) => setYtUrl(e.target.value)}
            className="mt-2 h-12 border-border bg-surface/60"
          />
          <p className="mt-2 text-xs text-muted-foreground">
            We resolve the stream server-side, then run ffmpeg.wasm + Lovable AI in your browser.
            Works best on videos under ~20 min.
          </p>
          {ytStatus && !ytError && (
            <p className="mt-3 flex items-center gap-2 text-xs text-primary">
              <Loader2 className="h-3 w-3 animate-spin" /> {ytStatus}
            </p>
          )}

          {ytError && (
            <div className="mt-4 rounded-xl border border-destructive/40 bg-destructive/5 p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div className="flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    Couldn't fetch this YouTube video
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    YouTube is currently blocking anonymous extraction, and all the free public
                    resolver APIs (Piped, Invidious, Cobalt) are down or auth-walled. This is
                    upstream — not a bug in your project.
                  </p>
                  <p className="mt-2 font-mono text-[11px] text-destructive/80">{ytError}</p>

                  <div className="mt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Workaround — download the MP4, then upload it here
                    </p>
                    <ol className="mt-2 space-y-1.5 text-xs text-foreground/90">
                      <li>
                        <span className="font-mono text-primary">1.</span> Open a free YouTube
                        downloader in a new tab:
                        <div className="mt-1.5 flex flex-wrap gap-2">
                          {[
                            {
                              label: "cobalt.tools",
                              href: ytVideoId
                                ? `https://cobalt.tools/?u=${encodeURIComponent(`https://youtu.be/${ytVideoId}`)}`
                                : "https://cobalt.tools/",
                            },
                            {
                              label: "ssyoutube.com",
                              href: ytVideoId
                                ? `https://ssyoutube.com/watch?v=${ytVideoId}`
                                : "https://ssyoutube.com/",
                            },
                            {
                              label: "y2mate.nu",
                              href: ytVideoId
                                ? `https://y2mate.nu/?url=${encodeURIComponent(`https://youtu.be/${ytVideoId}`)}`
                                : "https://y2mate.nu/",
                            },
                          ].map((s) => (
                            <a
                              key={s.label}
                              href={s.href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface/60 px-2.5 py-1 font-mono text-[11px] text-foreground hover:border-primary/60 hover:text-primary"
                            >
                              {s.label} <ExternalLink className="h-3 w-3" />
                            </a>
                          ))}
                        </div>
                      </li>
                      <li>
                        <span className="font-mono text-primary">2.</span> Pick an MP4 (360p or
                        720p is fine — smaller = faster ffmpeg.wasm).
                      </li>
                      <li>
                        <span className="font-mono text-primary">3.</span> Come back and drop it
                        into Local Upload.
                      </li>
                    </ol>
                    <Button
                      onClick={switchToUpload}
                      className="btn-glow mt-4 h-10 w-full rounded-lg text-sm font-semibold"
                    >
                      Switch to Local Upload <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </TabsContent>


        <TabsContent value="upload" className="mt-5">
          <Label htmlFor="file" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Video file (mp4, mov, mkv)
          </Label>
          <Input
            id="file"
            type="file"
            accept="video/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-2 h-12 cursor-pointer border-border bg-surface/60 file:mr-3 file:rounded-md file:border-0 file:bg-primary/20 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground"
          />
        </TabsContent>
      </Tabs>

      <div className="mt-7 grid gap-4 sm:grid-cols-2">
        <ConfigField label="Aspect Ratio">
          <Select value={aspect} onValueChange={(v) => setAspect(v as PipelineConfig["aspect_ratio"])}>
            <SelectTrigger className="h-11 border-border bg-surface/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="9:16">9:16 (Vertical Short)</SelectItem>
              <SelectItem value="1:1">1:1 (Square Clip)</SelectItem>
            </SelectContent>
          </Select>
        </ConfigField>

        <ConfigField label="Subtitle Style">
          <Select value={subStyle} onValueChange={(v) => setSubStyle(v as PipelineConfig["subtitle_style"])}>
            <SelectTrigger className="h-11 border-border bg-surface/60">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tiktok">TikTok (Glow & Bounce)</SelectItem>
              <SelectItem value="minimalist">Minimalist</SelectItem>
              <SelectItem value="podcast">Podcast Style</SelectItem>
            </SelectContent>
          </Select>
        </ConfigField>
      </div>

      <div className="mt-5 rounded-xl border border-border/60 bg-surface/40 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Number of Clips</p>
            <p className="text-xs text-muted-foreground">
              How many viral shorts to generate from this video.
            </p>
          </div>
          <span className="font-mono text-2xl font-bold text-primary tabular-nums">
            {clipCount}
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={8}
          step={1}
          value={clipCount}
          onChange={(e) => setClipCount(Number(e.target.value))}
          className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface accent-primary"
        />
        <div className="mt-1 flex justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>1</span>
          <span>8</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between rounded-xl border border-border/60 bg-surface/40 px-4 py-3">
        <div>
          <p className="text-sm font-medium">AI Face Tracking</p>
          <p className="text-xs text-muted-foreground">
            {faceTracking ? "Auto-frame speakers" : "Use center crop (fast)"}
          </p>
        </div>
        <Switch checked={faceTracking} onCheckedChange={setFaceTracking} />
      </div>

      <Button
        onClick={handleSubmit}
        disabled={submitting || disabled}
        className="btn-glow mt-7 h-12 w-full rounded-xl font-display text-base font-semibold"
      >
        {submitting ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Starting…
          </>
        ) : (
          <>
            <Sparkles className="mr-2 h-4 w-4" /> Generate Viral Clips
          </>
        )}
      </Button>
    </div>
  );
}

function ConfigField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      <div className="mt-2">{children}</div>
    </div>
  );
}

