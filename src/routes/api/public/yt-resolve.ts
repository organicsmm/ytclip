import { createFileRoute } from "@tanstack/react-router";

function extractVideoId(input: string): string | null {
  try {
    const u = new URL(input);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const parts = u.pathname.split("/");
      const i = parts.findIndex((p) => p === "shorts" || p === "embed" || p === "v");
      if (i >= 0 && parts[i + 1]) return parts[i + 1];
    }
  } catch {
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
  }
  return null;
}

type SmvdVideo = {
  url?: string;
  label?: string;
  metadata?: {
    itag?: number;
    width?: number;
    height?: number;
    content_length?: number;
    quality_label?: string;
    mime_type?: string;
    has_audio?: boolean;
    has_video?: boolean;
  };
};

type SmvdResponse = {
  error?: string | null;
  contents?: Array<{
    videos?: SmvdVideo[];
    title?: string;
    duration?: number;
    duration_formatted?: string;
    thumbnails?: Array<{ url: string }>;
  }>;
  metadata?: {
    title?: string;
    duration?: number;
    thumbnails?: Array<{ url: string }>;
  };
};

export const Route = createFileRoute("/api/public/yt-resolve")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const ytUrl = url.searchParams.get("url") ?? "";
        const videoId = extractVideoId(ytUrl);
        if (!videoId) {
          return Response.json({ error: "Invalid YouTube URL" }, { status: 400 });
        }

        const apiKey = process.env.RAPIDAPI_KEY;
        if (!apiKey) {
          return Response.json({ error: "RAPIDAPI_KEY is not configured on the server." });
        }

        try {
          const res = await fetch(
            `https://social-media-video-downloader.p.rapidapi.com/youtube/v3/video/details?videoId=${encodeURIComponent(videoId)}&urlAccess=normal&renderableFormats=720p%2C360p%2Chighres&getTranscript=false`,
            {
              headers: {
                "x-rapidapi-key": apiKey,
                "x-rapidapi-host": "social-media-video-downloader.p.rapidapi.com",
              },
            },
          );

          if (!res.ok) {
            const body = await res.text().catch(() => "");
            return Response.json({
              error: `Video downloader API failed (${res.status}). ${body.slice(0, 200)}`,
            });
          }

          const data = (await res.json()) as SmvdResponse;

          if (data.error) {
            return Response.json({ error: data.error });
          }

          const videos: SmvdVideo[] = data.contents?.[0]?.videos ?? [];
          if (videos.length === 0) {
            return Response.json({ error: "No video formats returned." });
          }

          // Prefer mp4 with audio+video, then by height
          const ranked = [...videos].sort((a, b) => {
            const aw = (a.metadata?.has_audio && a.metadata?.has_video) ? 1 : 0;
            const bw = (b.metadata?.has_audio && b.metadata?.has_video) ? 1 : 0;
            if (aw !== bw) return bw - aw;
            return (b.metadata?.height ?? 0) - (a.metadata?.height ?? 0);
          });
          const chosen = ranked[0];

          if (!chosen?.url) {
            return Response.json({ error: "No playable stream URL." });
          }

          const meta = data.contents?.[0];
          return Response.json({
            videoId,
            title: meta?.title ?? data.metadata?.title ?? "YouTube video",
            durationSec: meta?.duration ?? data.metadata?.duration ?? 0,
            streamUrl: chosen.url,
            mimeType: chosen.metadata?.mime_type?.split(";")[0] || "video/mp4",
            quality: chosen.metadata?.quality_label || `${chosen.metadata?.height ?? "?"}p`,
            thumbnail:
              meta?.thumbnails?.[meta.thumbnails.length - 1]?.url ??
              data.metadata?.thumbnails?.[0]?.url,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Failed to resolve";
          return Response.json({ error: `Resolver error: ${msg}` });
        }
      },
    },
  },
});
