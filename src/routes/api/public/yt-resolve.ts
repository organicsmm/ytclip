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
 * Apify-based YouTube resolver using `pintostudio/youtube-downloader` actor.
 * Runs entirely on Apify's cloud — independent of dev/user machines.
 * Docs: https://apify.com/pintostudio/youtube-downloader
 */
// Output shape from epctex/youtube-video-downloader. Field names vary across
// runs; we coerce defensively below.
type ApifyItem = {
  title?: string;
  duration?: string | number;
  durationSec?: number;
  thumbnail?: string;
  thumbnailUrl?: string;
  videoUrl?: string;
  downloadUrl?: string;
  url?: string;
  mimeType?: string;
  quality?: string;
  height?: number;
  medias?: Array<{
    url?: string;
    quality?: string;
    extension?: string;
    type?: string;
    is_audio?: boolean;
    has_audio?: boolean;
    height?: number;
    width?: number;
    mime_type?: string;
  }>;
};

function parseDuration(d: string | number | undefined): number {
  if (typeof d === "number") return d;
  if (!d) return 0;
  const parts = d.split(":").map((p) => Number(p));
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

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
            `https://api.apify.com/v2/acts/epctex~youtube-video-downloader/run-sync-get-dataset-items?token=${encodeURIComponent(apifyToken)}&timeout=180`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                startUrls: [cleanYtUrl],
                videoIds: [videoId],
                quality: "720",
              }),
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
          if (!item) {
            return Response.json({ error: "Apify returned no items." });
          }

          // Try top-level URL first (epctex shape), then fall back to medias array.
          const topUrl = item.downloadUrl || item.videoUrl || item.url;
          const medias = item.medias ?? [];
          // Prefer mp4 with audio+video, then highest height
          const ranked = [...medias]
            .filter((m) => m.url && !m.is_audio)
            .sort((a, b) => {
              const aHas = a.has_audio !== false ? 1 : 0;
              const bHas = b.has_audio !== false ? 1 : 0;
              if (aHas !== bHas) return bHas - aHas;
              return (b.height ?? 0) - (a.height ?? 0);
            });
          const chosen = ranked[0];
          const streamUrl = topUrl || chosen?.url;
          if (!streamUrl) {
            return Response.json({
              error: `No playable stream URL from Apify. Got: ${JSON.stringify(item).slice(0, 300)}`,
            });
          }

          return Response.json({
            videoId,
            title: item.title ?? "YouTube video",
            durationSec: parseDuration(item.durationSec ?? item.duration),
            streamUrl,
            mimeType: chosen?.mime_type?.split(";")[0] || item.mimeType?.split(";")[0] || "video/mp4",
            quality: chosen?.quality || item.quality || `${chosen?.height ?? item.height ?? "?"}p`,
            thumbnail: item.thumbnail || item.thumbnailUrl,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Failed to resolve";
          return Response.json({ error: `Resolver error: ${msg}` });
        }
      },
    },
  },
});
