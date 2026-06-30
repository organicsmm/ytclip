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

type YtApiFormat = {
  url?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  bitrate?: number;
  contentLength?: string;
  quality?: string;
  qualityLabel?: string;
  hasAudio?: boolean;
  hasVideo?: boolean;
};

type YtApiResponse = {
  title?: string;
  lengthSeconds?: string | number;
  thumbnail?: Array<{ url: string }>;
  formats?: YtApiFormat[];
  adaptiveFormats?: YtApiFormat[];
  message?: string;
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
          return Response.json({
            error: "RAPIDAPI_KEY is not configured on the server.",
          });
        }

        try {
          const res = await fetch(
            `https://yt-api.p.rapidapi.com/dl?id=${encodeURIComponent(videoId)}`,
            {
              headers: {
                "X-RapidAPI-Key": apiKey,
                "X-RapidAPI-Host": "yt-api.p.rapidapi.com",
              },
            },
          );

          if (!res.ok) {
            const body = await res.text().catch(() => "");
            return Response.json({
              error: `yt-api request failed (${res.status}). ${body.slice(0, 200)}`,
            });
          }

          const data = (await res.json()) as YtApiResponse;

          const all: YtApiFormat[] = [
            ...(data.formats ?? []),
            ...(data.adaptiveFormats ?? []),
          ];

          // Prefer progressive mp4 (has both audio + video) — these play directly in <video>
          const progressive = (data.formats ?? [])
            .filter(
              (f) =>
                f.url &&
                (f.mimeType || "").toLowerCase().includes("video/mp4") &&
                f.hasAudio === true &&
                f.hasVideo === true,
            )
            .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

          let chosen = progressive[0];

          // Fallback: best video-only mp4 (no audio, but still previewable)
          if (!chosen) {
            chosen = all
              .filter(
                (f) =>
                  f.url && (f.mimeType || "").toLowerCase().includes("video/mp4"),
              )
              .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
          }

          if (!chosen || !chosen.url) {
            return Response.json({
              error:
                "No playable mp4 stream returned by yt-api (video may be live, private, or age-restricted).",
            });
          }

          const durationSec =
            typeof data.lengthSeconds === "string"
              ? parseInt(data.lengthSeconds, 10) || 0
              : data.lengthSeconds ?? 0;

          return Response.json({
            videoId,
            title: data.title ?? "YouTube video",
            durationSec,
            streamUrl: chosen.url,
            mimeType: (chosen.mimeType || "video/mp4").split(";")[0],
            quality: chosen.qualityLabel || `${chosen.height ?? "?"}p`,
            thumbnail: data.thumbnail?.[data.thumbnail.length - 1]?.url,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Failed to resolve";
          return Response.json({ error: `yt-api error: ${msg}` });
        }
      },
    },
  },
});
