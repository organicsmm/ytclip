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

/**
 * Apify-based YouTube resolver using `api-ninja/youtube-video-downloader`.
 * Returns YouTube's native `formats` (combined a/v) and `adaptiveFormats`.
 * Runs on Apify's cloud — independent of dev/user machines.
 */
type YtFormat = {
  itag?: number;
  url?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  quality?: string;
  qualityLabel?: string;
  contentLength?: string;
  approxDurationMs?: string;
  audioQuality?: string;
};

type ApifyItem = {
  status?: string;
  id?: string;
  title?: string;
  lengthSeconds?: string | number;
  thumbnail?: Array<{ url?: string }>;
  formats?: YtFormat[];
  adaptiveFormats?: YtFormat[];
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

        const apifyToken = process.env.APIFY_API_TOKEN;
        if (!apifyToken) {
          return Response.json({ error: "APIFY_API_TOKEN is not configured on the server." });
        }

        const cleanYtUrl = `https://www.youtube.com/watch?v=${videoId}`;

        try {
          const res = await fetch(
            `https://api.apify.com/v2/acts/api-ninja~youtube-video-downloader/run-sync-get-dataset-items?token=${encodeURIComponent(apifyToken)}&timeout=180`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ urls: [cleanYtUrl] }),
            },
          );

          if (!res.ok) {
            const body = await res.text().catch(() => "");
            return Response.json({
              error: `Apify call failed (${res.status}). ${body.slice(0, 300)}`,
            });
          }

          const items = (await res.json()) as ApifyItem[];
          const item = items?.[0];
          if (!item || item.status !== "OK") {
            return Response.json({
              error: `Apify returned no playable item. Got: ${JSON.stringify(item ?? items).slice(0, 300)}`,
            });
          }

          // Prefer combined audio+video mp4 (itag 18 = 360p, itag 22 = 720p).
          // These play in the browser without muxing, so ffmpeg.wasm input is one file.
          const combined = (item.formats ?? []).filter(
            (f) => f.url && f.mimeType?.startsWith("video/mp4") && f.audioQuality,
          );
          combined.sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
          const chosen = combined[0] ?? item.formats?.[0];

          if (!chosen?.url) {
            return Response.json({
              error: "No combined audio+video mp4 stream found in Apify response.",
            });
          }

          const durationSec =
            typeof item.lengthSeconds === "string"
              ? Number(item.lengthSeconds) || 0
              : item.lengthSeconds ?? 0;

          return Response.json({
            videoId,
            title: item.title ?? "YouTube video",
            durationSec,
            streamUrl: chosen.url,
            mimeType: chosen.mimeType?.split(";")[0] || "video/mp4",
            quality: chosen.qualityLabel || chosen.quality || `${chosen.height ?? "?"}p`,
            thumbnail: item.thumbnail?.[item.thumbnail.length - 1]?.url,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Failed to resolve";
          return Response.json({ error: `Resolver error: ${msg}` });
        }
      },
    },
  },
});
