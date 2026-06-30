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

type ApifyItem = {
  status?: "completed" | "failed" | "OK" | string;
  jobId?: string;
  videoId?: string;
  id?: string;
  title?: string;
  originalUrl?: string;
  downloadUrl?: string;
  storageUrl?: string;
  contentType?: string;
  fileSizeMB?: string | number;
  fileSizeBytes?: string | number;
  expiresAt?: string;
  error?: string;
  lengthSeconds?: string | number;
  thumbnail?: Array<{ url?: string }>;
};

type ResolvePayload = {
  videoId: string;
  title: string;
  durationSec: number;
  streamUrl: string;
  audioUrl?: string;
  mimeType: string;
  quality: string;
  thumbnail?: string;
  source: "modal";
};

async function hmacHex(value: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function isAllowedMediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "apify.dziura.online" && url.pathname.startsWith("/temp/");
  } catch {
    return false;
  }
}

async function resolveWithModal(
  videoId: string,
  cleanYtUrl: string,
): Promise<{ ok: ResolvePayload } | { err: string; status?: number } | null> {
  const base = process.env.MODAL_YT_URL;
  const token = process.env.MODAL_AUTH_TOKEN;
  if (!base || !token) return null;

  try {
    const res = await fetch(
      `${base.replace(/\/$/, "")}/info?url=${encodeURIComponent(cleanYtUrl)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let detail = body;
      try {
        const parsed = JSON.parse(body) as { detail?: unknown; error?: unknown };
        detail = String(parsed.detail ?? parsed.error ?? body);
      } catch {
        // Modal platform errors are usually plain text.
      }
      console.error("[modal] /info failed", res.status, detail.slice(0, 500));
      return { err: `Modal ${res.status}: ${detail.slice(0, 200) || res.statusText}`, status: 502 };
    }
    const data = (await res.json()) as {
      title?: string;
      duration_sec?: number;
      thumbnail?: string;
      mime_type?: string;
      stream_path?: string;
    };
    if (!data.stream_path) return { err: "Modal returned no stream_path", status: 502 };
    const streamUrl = `${base.replace(/\/$/, "")}${data.stream_path}`;
    return {
      ok: {
        videoId,
        title: data.title ?? "YouTube video",
        durationSec: data.duration_sec ?? 0,
        streamUrl,
        mimeType: data.mime_type ?? "video/mp4",
        quality: "720p",
        thumbnail: data.thumbnail,
        source: "modal",
      },
    };
  } catch (e) {
    console.error("[modal] fetch threw", e);
    return { err: `Modal network error: ${(e as Error).message}`, status: 502 };
  }
}

export const Route = createFileRoute("/api/public/yt-resolve")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("download") === "1") {
          const mediaUrl = url.searchParams.get("u") ?? "";
          const sig = url.searchParams.get("sig") ?? "";
          const apifyToken = process.env.APIFY_API_TOKEN;
          if (!apifyToken) return new Response("Server missing APIFY_API_TOKEN", { status: 500 });
          if (!mediaUrl || !sig || !isAllowedMediaUrl(mediaUrl)) {
            return new Response("Invalid download URL", { status: 400 });
          }
          const expected = await hmacHex(mediaUrl, apifyToken);
          if (!safeEqual(sig, expected)) return new Response("Invalid download signature", { status: 403 });

          const range = request.headers.get("range") ?? undefined;
          const upstream = await fetch(mediaUrl, {
            headers: {
              "User-Agent": "Mozilla/5.0",
              ...(range ? { Range: range } : {}),
            },
            redirect: "follow",
          });
          if (!upstream.ok && upstream.status !== 206) {
            return new Response(`Cloud media download failed (${upstream.status})`, { status: 502 });
          }

          const headers = new Headers();
          for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
            const v = upstream.headers.get(h);
            if (v) headers.set(h, v);
          }
          if (!headers.has("content-type")) headers.set("content-type", "video/mp4");
          headers.set("Cache-Control", "no-store");
          headers.set("Access-Control-Allow-Origin", "*");
          return new Response(upstream.body, { status: upstream.status, headers });
        }

        const ytUrl = url.searchParams.get("url") ?? "";
        const videoId = extractVideoId(ytUrl);
        if (!videoId) {
          return Response.json({ error: "Invalid YouTube URL" }, { status: 400 });
        }

        const cleanYtUrlEarly = `https://www.youtube.com/watch?v=${videoId}`;
        // Modal-only resolver. Apify/RapidAPI fallbacks are disabled because
        // they can resolve successfully but then return browser-dead streams.
        const modalResult = await resolveWithModal(videoId, cleanYtUrlEarly);
        if (modalResult && "ok" in modalResult) return Response.json(modalResult.ok);
        const modalErr = modalResult && "err" in modalResult ? modalResult.err : "Modal not configured";
        const upstreamStatus = modalResult && "err" in modalResult ? modalResult.status ?? 502 : 503;

        // YouTube/Modal failures are expected operational failures, not app crashes.
        // Return 200 so the UI can render its existing fallback/workaround panel instead
        // of the preview treating the API response as an unhandled 5xx runtime error.
        return Response.json(
          { error: modalErr, upstreamStatus, source: "modal", retryable: true },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});

