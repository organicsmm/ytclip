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
  const isCompleted = video?.status === "completed";
  const isFailed = video?.status === "failed";
  // Prefer the server-reported progress when the backend pipeline is running,
  // otherwise fall back to step completion ratio for the pre-pipeline phase.
  const stepPct = Math.round((doneCount / stages.length) * 100);
  const pct = isCompleted
    ? 100
    : video && typeof video.progress === "number" && video.progress > 0
      ? Math.round(video.progress)
      : stepPct;

  const headline = isFailed
    ? "Failed"
    : isCompleted
      ? "Complete"
      : activeIdx >= 0
        ? stages[activeIdx].label
        : "Standby";

  return (
    <div className="paper-card h-full p-6">
      <div className="mb-4 flex items-end justify-between border-b border-[color:var(--color-ink)]/10 pb-4">
        <div>
          <p className="eyebrow">Pipeline</p>
          <h3 className="mt-2 font-display text-2xl italic text-[color:var(--color-ink)]">
            {headline}
          </h3>
        </div>
        <span className="font-mono text-xs text-foreground/55 tabular-nums">{pct}%</span>
      </div>

      {/* Live progress bar */}
      <div
        className="mb-4 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--color-ink)]/10"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Pipeline progress"
      >
        <div
          className={`h-full transition-all duration-500 ${
            isFailed ? "bg-destructive" : isCompleted ? "bg-success" : "bg-primary"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Completed / failed banner */}
      {isCompleted && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-xs text-foreground">
          <PartyPopper className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
          <span>
            <strong className="font-semibold">All clips ready.</strong> Scroll down to preview and
            download your MP4s.
          </span>
        </div>
      )}
      {isFailed && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <span className="flex-1">
            <strong className="font-semibold">Pipeline failed</strong>
            {video?.stage ? ` at ${humanStage(video.stage)}` : ""}.
            <span className="mt-0.5 block font-mono text-[11px] text-muted-foreground">
              {video?.error ?? "Check the terminal log below for details."}
            </span>
          </span>
        </div>
      )}

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
                <AlertTriangle className="h-4 w-4 text-destructive" />
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

function humanStage(stage: string): string {
  switch (stage) {
    case "queued":
      return "queue";
    case "downloading":
      return "upload";
    case "transcribing":
      return "transcribe";
    case "selecting":
      return "ranking";
    case "rendering":
      return "render";
    case "completed":
      return "completion";
    default:
      return stage;
  }
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
      label: "Step 1 · Upload to Lovable Cloud",
      state: stateFor("downloading"),
      detail:
        video && stage === "downloading"
          ? `${Math.round(video.progress)}% uploaded`
          : undefined,
    },
    {
      key: "transcribe",
      label: "Step 2 · Transcribe audio",
      detail:
        video && stage === "transcribing" ? "Probing video & loading ffmpeg.wasm…" : undefined,
      state: stateFor("transcribing"),
    },
    {
      key: "rank",
      label: "Step 3 · Rank viral moments",
      detail: video && stage === "selecting" ? "Lovable AI scoring highlights…" : undefined,
      state: stateFor("selecting"),
    },
    {
      key: "render",
      label: "Step 4 · Render & export clips",
      state: stateFor("rendering"),
      detail:
        video && stage === "rendering"
          ? `${Math.round(video.progress)}% rendered`
          : undefined,
    },
  ];

  return stages;
}
