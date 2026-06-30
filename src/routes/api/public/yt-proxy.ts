import { createFileRoute } from "@tanstack/react-router";

/**
 * Streams a YouTube video back to the browser. Pass ?id=<videoId>.
 * Re-resolves the stream URL via yt-api at request time (URLs from yt-api are
 * IP-locked, so we must fetch yt-api and the stream within the same request).
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

        // Re-resolve fresh URL right before fetching (IP-locked tokens)
        const metaRes = await fetch(
          `https://yt-api.p.rapidapi.com/dl?id=${encodeURIComponent(videoId)}`,
          {
            headers: {
              "X-RapidAPI-Key": apiKey,
              "X-RapidAPI-Host": "yt-api.p.rapidapi.com",
            },
          },
        );
        if (!metaRes.ok) {
          return new Response(`yt-api failed (${metaRes.status})`, { status: 502 });
        }
        type Fmt = {
          url?: string;
          mimeType?: string;
          height?: number;
          hasAudio?: boolean;
          hasVideo?: boolean;
        };
        const data = (await metaRes.json()) as { formats?: Fmt[]; adaptiveFormats?: Fmt[] };

        const progressive = (data.formats ?? [])
          .filter(
            (f) =>
              f.url &&
              (f.mimeType || "").toLowerCase().includes("video/mp4") &&
              f.hasAudio === true &&
              f.hasVideo === true,
          )
          .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
        const chosen =
          progressive[0] ??
          (data.adaptiveFormats ?? [])
            .filter(
              (f) => f.url && (f.mimeType || "").toLowerCase().includes("video/mp4"),
            )
            .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];

        if (!chosen?.url) {
          return new Response("No mp4 stream available", { status: 404 });
        }

        const range = request.headers.get("range") ?? undefined;
        const upstream = await fetch(chosen.url, {
          headers: range ? { Range: range } : {},
        });

        const headers = new Headers();
        for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
          const v = upstream.headers.get(h);
          if (v) headers.set(h, v);
        }
        if (!headers.has("content-type")) {
          headers.set("content-type", (chosen.mimeType || "video/mp4").split(";")[0]);
        }
        headers.set("Access-Control-Allow-Origin", "*");
        headers.set("Cache-Control", "no-store");

        return new Response(upstream.body, { status: upstream.status, headers });
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
