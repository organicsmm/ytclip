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

type RapidApiVideo = {
  url?: string;
  metadata?: {
    height?: number;
    has_audio?: boolean;
    has_video?: boolean;
    mime_type?: string;
  };
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
  source: "apify" | "rapidapi" | "modal";
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

async function fetchTitle(cleanYtUrl: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(cleanYtUrl)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { title?: string };
    return data.title || null;
  } catch {
    return null;
  }
}

function pickRapidApiVideo(videos: RapidApiVideo[]): RapidApiVideo | undefined {
  return [...videos].sort((a, b) => {
    const aMuxed = a.metadata?.has_audio && a.metadata?.has_video ? 1 : 0;
    const bMuxed = b.metadata?.has_audio && b.metadata?.has_video ? 1 : 0;
    if (aMuxed !== bMuxed) return bMuxed - aMuxed;
    const aHeight = a.metadata?.height ?? 0;
    const bHeight = b.metadata?.height ?? 0;
    const aPenalty = aHeight > 720 ? 1 : 0;
    const bPenalty = bHeight > 720 ? 1 : 0;
    if (aPenalty !== bPenalty) return aPenalty - bPenalty;
    return bHeight - aHeight;
  })[0];
}

async function resolveWithRapidApi(
  videoId: string,
  cleanYtUrl: string,
  fallbackTitle: string | null,
): Promise<ResolvePayload | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return null;

  const res = await fetch(
    `https://social-media-video-downloader.p.rapidapi.com/youtube/v3/video/details?videoId=${encodeURIComponent(videoId)}&urlAccess=normal&renderableFormats=720p%2C360p%2Chighres&getTranscript=false`,
    {
      headers: {
        "x-rapidapi-key": apiKey,
        "x-rapidapi-host": "social-media-video-downloader.p.rapidapi.com",
      },
    },
  );

  if (!res.ok) return null;

  const data = (await res.json()) as {
    title?: string;
    duration?: string | number;
    lengthSeconds?: string | number;
    thumbnail?: string;
    thumbnails?: Array<{ url?: string }>;
    contents?: Array<{ videos?: RapidApiVideo[] }>;
  };
  const videos = data.contents?.flatMap((content) => content.videos ?? []) ?? [];
  const chosen = pickRapidApiVideo(videos);
  if (!chosen?.url) return null;

  const durationRaw = data.lengthSeconds ?? data.duration ?? 0;
  const durationSec = typeof durationRaw === "string" ? Number(durationRaw) || 0 : durationRaw;
  const thumbnail = data.thumbnail ?? data.thumbnails?.[data.thumbnails.length - 1]?.url;

  return {
    videoId,
    title: data.title ?? fallbackTitle ?? "YouTube video",
    durationSec,
    streamUrl: `/api/public/yt-proxy?id=${encodeURIComponent(videoId)}&kind=video`,
    audioUrl: `/api/public/yt-proxy?id=${encodeURIComponent(videoId)}&kind=audio`,
    mimeType: chosen.metadata?.mime_type?.split(";")[0] || "video/mp4",
    quality: chosen.metadata?.height ? `${chosen.metadata.height}p` : "auto",
    thumbnail,
    source: "rapidapi",
  };
}

async function resolveWithModal(
  videoId: string,
  cleanYtUrl: string,
): Promise<ResolvePayload | null> {
  const base = process.env.MODAL_YT_URL;
  const token = process.env.MODAL_AUTH_TOKEN;
  if (!base || !token) return null;

  try {
    const res = await fetch(
      `${base.replace(/\/$/, "")}/info?url=${encodeURIComponent(cleanYtUrl)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      duration_sec?: number;
      thumbnail?: string;
      mime_type?: string;
      stream_path?: string;
    };
    if (!data.stream_path) return null;
    const streamUrl = `${base.replace(/\/$/, "")}${data.stream_path}`;
    return {
      videoId,
      title: data.title ?? "YouTube video",
      durationSec: data.duration_sec ?? 0,
      streamUrl,
      mimeType: data.mime_type ?? "video/mp4",
      quality: "720p",
      thumbnail: data.thumbnail,
      source: "modal",
    };
  } catch {
    return null;
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
        // Modal is primary — Apify disabled.
        const modalFirst = await resolveWithModal(videoId, cleanYtUrlEarly);
        if (modalFirst) return Response.json(modalFirst);

        // If Modal fails, try RapidAPI as last resort.
        const rapidLast = await resolveWithRapidApi(videoId, cleanYtUrlEarly, await fetchTitle(cleanYtUrlEarly));
        if (rapidLast) return Response.json(rapidLast);

        return Response.json({ error: "Modal resolver failed and no fallback available." });
      },
    },
  },
});

