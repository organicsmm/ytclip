export type VideoStatus = "processing" | "completed" | "failed";

export type VideoStage =
  | "queued"
  | "downloading"
  | "transcribing"
  | "chunking"
  | "selecting"
  | "rendering"
  | "completed"
  | "failed";

export interface PipelineConfig {
  aspect_ratio: "9:16" | "1:1";
  subtitle_style: "tiktok" | "minimalist" | "podcast";
  face_tracking: boolean;
}

export interface VideoRow {
  id: string;
  title: string;
  source_url: string | null;
  source_type: "youtube" | "upload";
  status: VideoStatus;
  stage: VideoStage;
  progress: number;
  log_lines: string[];
  config: PipelineConfig;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ClipRow {
  id: string;
  video_id: string;
  title: string;
  start_time: number;
  end_time: number;
  score: number;
  hook: string | null;
  video_url: string | null;
  hashtags: string[];
  aspect_ratio: "9:16" | "1:1";
  created_at: string;
}
