import { Check, Loader2, Circle, AlertTriangle, PartyPopper } from "lucide-react";
import type { VideoRow } from "@/lib/autocliper-types";

export type PreStage =
  | { kind: "idle" }
  | { kind: "resolving" }
  | { kind: "downloading"; loaded: number; total: number }
  | { kind: "uploading" };

interface Props {
  video: VideoRow | null;
  preStage: PreStage;
}

type StageState = "pending" | "active" | "done" | "failed";

interface StageInfo {
  key: string;
  label: string;
  detail?: string;
  state: StageState;
}

function fmtMB(bytes: number) {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export function PipelineStages({ video, preStage }: Props) {
  const stages: StageInfo[] = buildStages(video, preStage);
  const activeIdx = stages.findIndex((s) => s.state === "active");
  const doneCount = stages.filter((s) => s.state === "done").length;
  const pct = Math.round((doneCount / stages.length) * 100);

  return (
    <div className="paper-card h-full p-6">
      <div className="mb-6 flex items-end justify-between border-b border-[color:var(--color-ink)]/10 pb-4">
        <div>
          <p className="eyebrow">Pipeline</p>
          <h3 className="mt-2 font-display text-2xl italic text-[color:var(--color-ink)]">
            {activeIdx >= 0
              ? stages[activeIdx].label
              : video?.status === "completed"
                ? "Complete"
                : video?.status === "failed"
                  ? "Failed"
                  : "Standby"}
          </h3>
        </div>
        <span className="font-mono text-xs text-foreground/55">{pct}%</span>
      </div>

      <ol className="space-y-2">
        {stages.map((s) => (
          <li
            key={s.key}
            className={`flex items-start gap-3 rounded-lg border px-3 py-2 transition-colors ${
              s.state === "active"
                ? "border-primary/60 bg-primary/5"
                : s.state === "done"
                  ? "border-success/40 bg-success/5"
                  : s.state === "failed"
                    ? "border-destructive/60 bg-destructive/10"
                    : "border-border/50 bg-surface/30"
            }`}
          >
            <span className="mt-0.5">
              {s.state === "done" ? (
                <Check className="h-4 w-4 text-success" />
              ) : s.state === "active" ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : s.state === "failed" ? (
                <Circle className="h-4 w-4 text-destructive" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground/40" />
              )}
            </span>
            <span className="flex-1">
              <span
                className={`block text-sm font-medium ${
                  s.state === "pending" ? "text-muted-foreground" : "text-foreground"
                }`}
              >
                {s.label}
              </span>
              {s.detail && (
                <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
                  {s.detail}
                </span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function buildStages(video: VideoRow | null, pre: PreStage): StageInfo[] {
  const isFailed = video?.status === "failed";
  const failedAt = isFailed ? video?.stage : null;

  // Pre-pipeline (YouTube) stages
  const ytResolve: StageInfo = {
    key: "yt-resolve",
    label: "Resolve YouTube stream",
    state:
      pre.kind === "resolving"
        ? "active"
        : pre.kind === "downloading" || pre.kind === "uploading" || video
          ? "done"
          : "pending",
  };
  const ytDownload: StageInfo = {
    key: "yt-download",
    label: "Download source",
    detail:
      pre.kind === "downloading"
        ? pre.total
          ? `${fmtMB(pre.loaded)} / ${fmtMB(pre.total)}`
          : fmtMB(pre.loaded)
        : undefined,
    state:
      pre.kind === "downloading"
        ? "active"
        : pre.kind === "uploading" || video
          ? "done"
          : "pending",
  };

  // Backend pipeline stages
  const stage = video?.stage;
  const stageOrder: VideoRow["stage"][] = [
    "downloading",
    "transcribing",
    "selecting",
    "rendering",
    "completed",
  ];
  const idx = stage ? stageOrder.indexOf(stage) : -1;
  const stateFor = (target: VideoRow["stage"]): StageState => {
    if (!video) return "pending";
    if (failedAt === target) return "failed";
    const t = stageOrder.indexOf(target);
    if (t < idx) return "done";
    if (t === idx) return video.status === "completed" ? "done" : "active";
    return "pending";
  };

  const stages: StageInfo[] = [
    ytResolve,
    ytDownload,
    {
      key: "upload",
      label: "Upload to Lovable Cloud",
      state: stateFor("downloading"),
      detail: video && idx >= 0 ? `progress ${Math.round(video.progress)}%` : undefined,
    },
    {
      key: "ffmpeg",
      label: "Load ffmpeg.wasm & probe video",
      state: stateFor("transcribing"),
    },
    {
      key: "ai",
      label: "AI selects viral moments",
      state: stateFor("selecting"),
    },
    {
      key: "render",
      label: "Render & export clips",
      state: stateFor("rendering"),
      detail:
        video && stage === "rendering" ? `progress ${Math.round(video.progress)}%` : undefined,
    },
  ];

  return stages;
}
