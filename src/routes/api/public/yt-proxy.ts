import { createFileRoute } from "@tanstack/react-router";

/**
 * Same-origin YouTube stream proxy. Pass ?id=<videoId>&kind=video|audio.
 * The RapidAPI fallback returns separate DASH audio/video streams, and direct
 * browser redirects can be blocked by CORS, so this route streams the bytes
 * through our own endpoint.
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

        const range = request.headers.get("range") ?? undefined;
        const upstream = await fetch(chosen.url, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Accept-Language": "en-US,en;q=0.9",
            ...(range ? { Range: range } : {}),
          },
          redirect: "follow",
        });

        if (!upstream.ok && upstream.status !== 206) {
          const body = await upstream.text().catch(() => "");
          return new Response(
            `Stream download failed (${upstream.status})${body ? `: ${body.slice(0, 160)}` : ""}`,
            {
              status: 502,
              headers: {
                "Access-Control-Allow-Origin": "*",
                "Cache-Control": "no-store",
              },
            },
          );
        }

        if (!upstream.body) {
          return new Response("Stream returned no body", {
            status: 502,
            headers: {
              "Access-Control-Allow-Origin": "*",
              "Cache-Control": "no-store",
            },
          });
        }

        const headers = new Headers();
        for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
          const value = upstream.headers.get(h);
          if (value) headers.set(h, value);
        }
        if (!headers.has("content-type")) {
          headers.set(
            "content-type",
            chosen.metadata?.mime_type ?? (kind === "audio" ? "audio/mp4" : "video/mp4"),
          );
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
