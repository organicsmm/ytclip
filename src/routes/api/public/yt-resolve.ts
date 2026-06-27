import { createFileRoute } from "@tanstack/react-router";

const PIPED_INSTANCES = [
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://api.piped.private.coffee",
  "https://pipedapi.reallyaweso.me",
];

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

interface PipedStream {
  url: string;
  mimeType: string;
  videoOnly: boolean;
  quality: string;
  format: string;
  bitrate?: number;
  height?: number;
}

interface PipedResponse {
  title: string;
  duration: number;
  videoStreams: PipedStream[];
}

async function fetchFromPiped(videoId: string): Promise<PipedResponse> {
  let lastErr: unknown;
  for (const base of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        lastErr = new Error(`${base} returned ${res.status}`);
        continue;
      }
      return (await res.json()) as PipedResponse;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`All Piped instances failed: ${String(lastErr)}`);
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
        try {
          const data = await fetchFromPiped(videoId);
          // Prefer progressive mp4 (videoOnly=false, has audio) at moderate quality
          const progressive = data.videoStreams
            .filter((s) => !s.videoOnly && s.format?.toLowerCase().includes("mp4"))
            .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
          const chosen = progressive[0] ?? data.videoStreams.find((s) => !s.videoOnly);
          if (!chosen) {
            return Response.json({ error: "No progressive stream available" }, { status: 502 });
          }
          return Response.json({
            videoId,
            title: data.title,
            durationSec: data.duration,
            streamUrl: chosen.url,
            mimeType: chosen.mimeType || "video/mp4",
            quality: chosen.quality,
          });
        } catch (e) {
          return Response.json(
            { error: e instanceof Error ? e.message : "Failed to resolve" },
            { status: 502 },
          );
        }
      },
    },
  },
});
