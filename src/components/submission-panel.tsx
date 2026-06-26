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
import { z } from "zod";
import { startMockPipeline } from "@/lib/mock-pipeline";
import type { PipelineConfig } from "@/lib/skate-types";

const YT = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/i;
const youtubeSchema = z.string().trim().regex(YT, "Enter a valid YouTube URL");

interface Props {
  onJobStarted: (videoId: string) => void;
  disabled?: boolean;
}

export function SubmissionPanel({ onJobStarted, disabled }: Props) {
  const [tab, setTab] = useState<"youtube" | "upload">("youtube");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [aspect, setAspect] = useState<PipelineConfig["aspect_ratio"]>("9:16");
  const [subStyle, setSubStyle] = useState<PipelineConfig["subtitle_style"]>("tiktok");
  const [faceTracking, setFaceTracking] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      let title = "Untitled video";
      let sourceUrl: string | null = null;

      if (tab === "youtube") {
        const parsed = youtubeSchema.safeParse(url);
        if (!parsed.success) {
          toast.error(parsed.error.issues[0]?.message ?? "Invalid URL");
          return;
        }
        sourceUrl = parsed.data;
        title = deriveYouTubeTitle(parsed.data);
      } else {
        if (!file) {
          toast.error("Choose a video file to upload");
          return;
        }
        title = file.name.replace(/\.[^.]+$/, "");
      }

      const videoId = await startMockPipeline({
        title,
        source_url: sourceUrl,
        source_type: tab,
        config: {
          aspect_ratio: aspect,
          subtitle_style: subStyle,
          face_tracking: faceTracking,
        },
      });

      onJobStarted(videoId);
      toast.success("Pipeline started", { description: "Watch the terminal for live progress." });
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
          <Label htmlFor="yt-url" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Video URL
          </Label>
          <Input
            id="yt-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="mt-2 h-12 border-border bg-surface/60 font-mono text-sm placeholder:text-muted-foreground/50"
            maxLength={500}
          />
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

      <div className="mt-5 flex items-center justify-between rounded-xl border border-border/60 bg-surface/40 px-4 py-3">
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

function deriveYouTubeTitle(url: string): string {
  try {
    const u = new URL(url);
    const id = u.searchParams.get("v") || u.pathname.split("/").filter(Boolean).pop();
    return id ? `YouTube · ${id}` : "YouTube video";
  } catch {
    return "YouTube video";
  }
}
