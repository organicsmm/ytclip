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
import { Link2, Upload, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { startRealPipeline } from "@/lib/real-pipeline";
import type { PipelineConfig } from "@/lib/skate-types";

interface Props {
  onJobStarted: (videoId: string) => void;
  disabled?: boolean;
}

export function SubmissionPanel({ onJobStarted, disabled }: Props) {
  const [tab, setTab] = useState<"youtube" | "upload">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [aspect, setAspect] = useState<PipelineConfig["aspect_ratio"]>("9:16");
  const [subStyle, setSubStyle] = useState<PipelineConfig["subtitle_style"]>("tiktok");
  const [faceTracking, setFaceTracking] = useState(false);
  const [clipCount, setClipCount] = useState(5);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      if (tab === "youtube") {
        toast.error("YouTube fetch unavailable", {
          description:
            "Browser-only mode can't download from YouTube. Download the video and upload the file instead.",
        });
        return;
      }
      if (!file) {
        toast.error("Choose a video file to upload");
        return;
      }
      const title = file.name.replace(/\.[^.]+$/, "");

      const videoId = await startRealPipeline({
        file,
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
    }
  };

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
          <div className="rounded-xl border border-dashed border-border/70 bg-surface/40 p-5 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">YouTube direct fetch is off in browser-only mode.</p>
            <p className="mt-1.5">
              Skate runs the entire pipeline locally (ffmpeg.wasm + Lovable AI) — no external
              workers. Download the source video and use the{" "}
              <button
                type="button"
                onClick={() => setTab("upload")}
                className="font-medium text-primary underline-offset-2 hover:underline"
              >
                Local Upload
              </button>{" "}
              tab.
            </p>
          </div>
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

