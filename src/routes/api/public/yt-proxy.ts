import { createFileRoute } from "@tanstack/react-router";

/**
 * Returns a short-lived 302 redirect to a fresh googlevideo URL for a YouTube
 * stream. Pass ?id=<videoId>&kind=video|audio.
 *
 * Why a redirect (not a worker proxy): the tunnel URLs from smvd embed the
 * *requesting* IP into the resulting googlevideo URL. If the worker fetches
 * the tunnel, the googlevideo URL is locked to the worker's IP — and
 * googlevideo CDN frequently 403s requests from datacenter IPs. By
 * redirecting, the browser fetches the tunnel itself, so the googlevideo URL
 * is bound to the user's IP and works.
 *
 * Note: smvd does not provide a muxed (audio+video) MP4 — only separate
 * DASH streams. The client is expected to download both and mux locally
 * (ffmpeg.wasm `-c copy`).
 */
export const Route = createFileRoute("/api/public/yt-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const videoId = url.searchParams.get("id");
        const kind = (url.searchParams.get("kind") ?? "video") as "video" | "audio";
        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
          return new Response("Missing or invalid id", { status: 400 });
        }
        if (kind !== "video" && kind !== "audio") {
          return new Response("Invalid kind", { status: 400 });
        }

        const apiKey = process.env.RAPIDAPI_KEY;
        if (!apiKey) {
          return new Response("Server missing RAPIDAPI_KEY", { status: 500 });
        }

        const metaRes = await fetch(
          `https://social-media-video-downloader.p.rapidapi.com/youtube/v3/video/details?videoId=${encodeURIComponent(videoId)}&urlAccess=normal&getTranscript=false`,
          {
            headers: {
              "x-rapidapi-key": apiKey,
              "x-rapidapi-host": "social-media-video-downloader.p.rapidapi.com",
            },
          },
        );

        if (!metaRes.ok) {
          return new Response(`Resolver failed (${metaRes.status})`, { status: 502 });
        }

        type Stream = {
          url?: string;
          metadata?: {
            height?: number;
            has_audio?: boolean;
            has_video?: boolean;
            mime_type?: string;
            bitrate?: number;
          };
        };
        const data = (await metaRes.json()) as {
          contents?: Array<{ videos?: Stream[]; audios?: Stream[] }>;
        };
        const all = data.contents ?? [];

        let chosen: Stream | undefined;
        if (kind === "video") {
          const videos = all.flatMap((c) => c.videos ?? []);
          // Prefer mp4/avc1 at <=720p for ffmpeg.wasm compatibility.
          chosen = [...videos]
            .filter((v) => (v.metadata?.mime_type || "").startsWith("video/mp4"))
            .sort((a, b) => {
              const ah = a.metadata?.height ?? 0;
              const bh = b.metadata?.height ?? 0;
              const aPenalty = ah > 720 ? 1 : 0;
              const bPenalty = bh > 720 ? 1 : 0;
              if (aPenalty !== bPenalty) return aPenalty - bPenalty;
              return bh - ah;
            })[0];
          if (!chosen) chosen = videos[0];
        } else {
          const audios = all.flatMap((c) => c.audios ?? []);
          // Prefer mp4/aac for clean mux with mp4 video.
          chosen = [...audios]
            .filter((a) => (a.metadata?.mime_type || "").startsWith("audio/mp4"))
            .sort(
              (a, b) => (b.metadata?.bitrate ?? 0) - (a.metadata?.bitrate ?? 0),
            )[0];
          if (!chosen) chosen = audios[0];
        }

        if (!chosen?.url) {
          return new Response(`No ${kind} stream available`, { status: 404 });
        }

        return new Response(null, {
          status: 302,
          headers: {
            Location: chosen.url,
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store",
          },
        });
      },
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Range, Content-Type",
          },
        }),
    },
  },
});
