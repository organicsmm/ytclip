import { supabase } from "@/integrations/supabase/client";
import type { PipelineConfig } from "@/lib/autocliper-types";

interface StartParams {
  file?: File | null;
  ytUrl?: string | null;
  title: string;
  config: PipelineConfig;
  clipCount: number;
}

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8080";

export async function startRealPipeline(params: StartParams): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Authentication required");

  // 1. YouTube Flow
  if (params.ytUrl) {
    const response = await fetch(`${BACKEND_URL}/api/videos`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        title: params.title,
        source_url: params.ytUrl,
        source_type: "youtube",
        config: {
          aspect_ratio: params.config.aspect_ratio,
          subtitle_style: params.config.subtitle_style,
          face_tracking: params.config.face_tracking,
          clip_count: params.clipCount,
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || "Failed to start YouTube pipeline");
    }

    const data = (await response.json()) as { video_id: string };
    return data.video_id;
  }

  // 2. File Upload Flow
  if (params.file) {
    const formData = new FormData();
    formData.append("file", params.file);
    formData.append("title", params.title);
    formData.append("config", JSON.stringify({
      aspect_ratio: params.config.aspect_ratio,
      subtitle_style: params.config.subtitle_style,
      face_tracking: params.config.face_tracking,
      clip_count: params.clipCount,
    }));

    const response = await fetch(`${BACKEND_URL}/api/videos`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(errText || "Failed to start video upload pipeline");
    }

    const data = (await response.json()) as { video_id: string };
    return data.video_id;
  }

  throw new Error("No source file or YouTube URL provided");
}

export async function resumeRealPipelineFromStoredSource(videoId: string): Promise<string> {
  const { data: video, error } = await supabase
    .from("videos")
    .select("*")
    .eq("id", videoId)
    .single();

  if (error || !video) {
    throw new Error(error?.message || "Failed to load video row for resume");
  }

  // Restart video job using backend by resubmitting the existing parameters
  const isYoutube = video.source_type === "youtube";
  const config = (video.config as Record<string, any>) || {};
  return startRealPipeline({
    ytUrl: isYoutube ? video.source_url : null,
    file: null, // For uploads, the backend resolves the file from Supabase storage using video.source_url
    title: video.title,
    clipCount: Number(config.clip_count ?? 5),
    config: {
      aspect_ratio: config.aspect_ratio ?? "9:16",
      subtitle_style: config.subtitle_style ?? "tiktok",
      face_tracking: config.face_tracking ?? false,
    },
  });
}

// Dummy stub to satisfy imports if called during compilation
export async function muxAudioVideoToMp4(
  videoBlob: Blob,
  audioBlob: Blob,
  onLog?: (msg: string) => void,
): Promise<Blob> {
  throw new Error("Muxing is now handled directly by the cloud backend services");
}
