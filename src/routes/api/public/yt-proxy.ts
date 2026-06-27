import { createFileRoute } from "@tanstack/react-router";

/**
 * Streams a remote (YouTube googlevideo) URL back to the browser with CORS
 * headers so ffmpeg.wasm / Blob() can read it. URL is passed as ?u=<encoded>.
 */
export const Route = createFileRoute("/api/public/yt-proxy")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const target = url.searchParams.get("u");
        if (!target) return new Response("Missing u", { status: 400 });
        let parsed: URL;
        try {
          parsed = new URL(target);
        } catch {
          return new Response("Invalid u", { status: 400 });
        }
        // Only allow googlevideo hosts to prevent open-proxy abuse
        if (!/\.googlevideo\.com$/i.test(parsed.hostname)) {
          return new Response("Forbidden host", { status: 403 });
        }

        const range = request.headers.get("range") ?? undefined;
        const upstream = await fetch(parsed.toString(), {
          headers: range ? { Range: range } : {},
        });

        const headers = new Headers();
        for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
          const v = upstream.headers.get(h);
          if (v) headers.set(h, v);
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
