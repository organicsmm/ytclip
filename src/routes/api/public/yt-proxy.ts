import { createFileRoute } from "@tanstack/react-router";

/**
 * Streams a YouTube video back to the browser. Pass ?id=<videoId>.
 * Re-resolves a fresh tunnel URL via the smvd RapidAPI each call (tunnel URLs
 * are short-lived and embed the caller's IP in the resulting redirect).
 */
export const Route = createFileRoute("/api/public/yt-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const videoId = url.searchParams.get("id");
        if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
          return new Response("Missing or invalid id", { status: 400 });
        }

        const apiKey = process.env.RAPIDAPI_KEY;
        if (!apiKey) {
          return new Response("Server missing RAPIDAPI_KEY", { status: 500 });
        }

        const metaRes = await fetch(
          `https://social-media-video-downloader.p.rapidapi.com/youtube/v3/video/details?videoId=${encodeURIComponent(videoId)}&urlAccess=normal&renderableFormats=720p%2C360p%2Chighres&getTranscript=false`,
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

        type V = {
          url?: string;
          metadata?: {
            height?: number;
            has_audio?: boolean;
            has_video?: boolean;
            mime_type?: string;
          };
        };
        const data = (await metaRes.json()) as {
          contents?: Array<{ videos?: V[] }>;
        };
        const videos = data.contents?.[0]?.videos ?? [];
        const chosen = [...videos].sort((a, b) => {
          const aw = a.metadata?.has_audio && a.metadata?.has_video ? 1 : 0;
          const bw = b.metadata?.has_audio && b.metadata?.has_video ? 1 : 0;
          if (aw !== bw) return bw - aw;
          return (b.metadata?.height ?? 0) - (a.metadata?.height ?? 0);
        })[0];

        if (!chosen?.url) {
          return new Response("No stream available", { status: 404 });
        }

        const range = request.headers.get("range") ?? undefined;
        const upstream = await fetch(chosen.url, {
          headers: range ? { Range: range } : {},
          redirect: "follow",
        });

        const headers = new Headers();
        for (const h of [
          "content-type",
          "content-length",
          "content-range",
          "accept-ranges",
        ]) {
          const v = upstream.headers.get(h);
          if (v) headers.set(h, v);
        }
        if (!headers.has("content-type")) {
          headers.set(
            "content-type",
            (chosen.metadata?.mime_type || "video/mp4").split(";")[0],
          );
        }
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Cache-Control", "no-store");

        return new Response(upstream.body, {
          status: upstream.status,
          headers,
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
