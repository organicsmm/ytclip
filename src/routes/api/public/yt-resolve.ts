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
  url?: string;
  output?: ApifyItem | ApifyItem[];
  data?: ApifyItem | ApifyItem[];
  items?: ApifyItem[];
  contentType?: string;
  fileSizeMB?: string | number;
  fileSizeBytes?: string | number;
  expiresAt?: string;
  error?: string;
  lengthSeconds?: string | number;
  duration?: string | number;
  durationSec?: string | number;
  thumbnail?: Array<{ url?: string }>;
  thumbnailUrl?: string;
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
  source: "modal" | "rapidapi" | "apify";
};

type RapidStream = {
  url?: string;
  metadata?: {
    height?: number;
    has_audio?: boolean;
    has_video?: boolean;
    mime_type?: string;
    bitrate?: number;
  };
};

type RapidApiDetails = {
  title?: string;
  duration?: number | string;
  durationSec?: number | string;
  duration_seconds?: number | string;
  thumbnail?: string;
  thumbnails?: Array<{ url?: string }>;
  contents?: Array<{ videos?: RapidStream[]; audios?: RapidStream[] }>;
};

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "0.0.0.0" ||
      host === "169.254.169.254" ||
      host.endsWith(".local")
    ) return false;
    return true;
  } catch {
    return false;
  }
}

function flattenApifyItems(value: unknown): ApifyItem[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenApifyItems);
  if (typeof value !== "object") return [];
  const item = value as ApifyItem;
  return [
    item,
    ...flattenApifyItems(item.output),
    ...flattenApifyItems(item.data),
    ...flattenApifyItems(item.items),
  ];
}

function firstDownloadableApifyItem(value: unknown): ApifyItem | undefined {
  return flattenApifyItems(value).find((item) => item.downloadUrl || item.storageUrl || item.url);
}

async function resolveWithApify(
  videoId: string,
  cleanYtUrl: string,
): Promise<{ ok: ResolvePayload } | { err: string; status?: number } | null> {
  const apiToken = process.env.APIFY_API_TOKEN;
  if (!apiToken) return null;

  try {
    const res = await fetchWithTimeout(
      `https://api.apify.com/v2/acts/scraper_one~yt-downloader/run-sync?token=${encodeURIComponent(apiToken)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrls: [cleanYtUrl], quality: "720p", audioOnly: false }),
      },
      90000,
    );

    const bodyText = await res.text().catch(() => "");
    if (!res.ok) {
      console.error("[apify] actor failed", res.status, bodyText.slice(0, 500));
      return { err: `Apify ${res.status}: ${bodyText.slice(0, 160) || res.statusText}`, status: 502 };
    }

    let parsed: unknown;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      return { err: "Apify returned invalid JSON", status: 502 };
    }

    const item = firstDownloadableApifyItem(parsed);
    const mediaUrl = item?.downloadUrl ?? item?.storageUrl ?? item?.url;
    if (!mediaUrl || !isAllowedMediaUrl(mediaUrl)) {
      return { err: "Apify returned no safe downloadable MP4 URL", status: 502 };
    }

    const probeError = await probeDirectMediaUrl(mediaUrl, "Apify video");
    if (probeError) return { err: probeError, status: 502 };

    const sig = await hmacHex(mediaUrl, apiToken);
    const durationRaw = item?.durationSec ?? item?.lengthSeconds ?? item?.duration;
    const durationSec = typeof durationRaw === "number" ? durationRaw : Number(durationRaw ?? 0) || 0;
    const thumb = item?.thumbnailUrl ?? item?.thumbnail?.find((t) => t.url)?.url;

    return {
      ok: {
        videoId,
        title: item?.title ?? "YouTube video",
        durationSec,
        streamUrl: `/api/public/yt-resolve?download=1&u=${encodeURIComponent(mediaUrl)}&sig=${sig}`,
        mimeType: item?.contentType ?? "video/mp4",
        quality: "720p",
        thumbnail: thumb,
        source: "apify",
      },
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[apify] fetch threw", e);
    return { err: `Apify network error: ${message}`, status: 502 };
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

function pickRapidVideo(videos: RapidStream[]): RapidStream | undefined {
  return [...videos]
    .filter((v) => (v.metadata?.mime_type || "").startsWith("video/mp4"))
    .sort((a, b) => {
      const ah = a.metadata?.height ?? 0;
      const bh = b.metadata?.height ?? 0;
      const aPenalty = ah > 720 ? 1 : 0;
      const bPenalty = bh > 720 ? 1 : 0;
      if (aPenalty !== bPenalty) return aPenalty - bPenalty;
      return bh - ah;
    })[0] ?? videos[0];
}

function pickRapidAudio(audios: RapidStream[]): RapidStream | undefined {
  return [...audios]
    .filter((a) => (a.metadata?.mime_type || "").startsWith("audio/mp4"))
    .sort((a, b) => (b.metadata?.bitrate ?? 0) - (a.metadata?.bitrate ?? 0))[0] ?? audios[0];
}

async function probeRapidStream(stream: RapidStream, label: string): Promise<string | null> {
  if (!stream.url) return `${label} stream is missing URL`;
  return probeDirectMediaUrl(stream.url, label);
}

async function probeDirectMediaUrl(mediaUrl: string, label: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(
      mediaUrl,
      {
        headers: {
          Range: "bytes=0-1023",
          "User-Agent": "Mozilla/5.0",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "follow",
      },
      8000,
    );
    await res.body?.cancel().catch(() => undefined);
    if (res.ok || res.status === 206) return null;
    return `${label} stream rejected by upstream (${res.status})`;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return `${label} stream probe failed: ${message}`;
  }
}

async function resolveWithRapidApi(
  videoId: string,
): Promise<{ ok: ResolvePayload } | { err: string; status?: number } | null> {
  const apiKey = process.env.RAPIDAPI_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://social-media-video-downloader.p.rapidapi.com/youtube/v3/video/details?videoId=${encodeURIComponent(videoId)}&urlAccess=normal&getTranscript=false`,
      {
        headers: {
          "x-rapidapi-key": apiKey,
          "x-rapidapi-host": "social-media-video-downloader.p.rapidapi.com",
        },
      },
    );

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[rapidapi] details failed", res.status, body.slice(0, 500));
      return { err: `RapidAPI ${res.status}: ${body.slice(0, 160) || res.statusText}`, status: 502 };
    }

    const data = (await res.json()) as RapidApiDetails;
    const videos = (data.contents ?? []).flatMap((c) => c.videos ?? []);
    const audios = (data.contents ?? []).flatMap((c) => c.audios ?? []);
    const video = pickRapidVideo(videos);
    const audio = pickRapidAudio(audios);

    if (!video?.url) return { err: "RapidAPI returned no playable video stream", status: 502 };

    const durationRaw = data.durationSec ?? data.duration_seconds ?? data.duration;
    const durationSec = typeof durationRaw === "number" ? durationRaw : Number(durationRaw ?? 0) || 0;
    const needsAudio = video.metadata?.has_audio === false && !!audio?.url;
    const height = video.metadata?.height;

    const videoProbeError = await probeRapidStream(video, "RapidAPI video");
    if (videoProbeError) return { err: videoProbeError, status: 502 };
    if (needsAudio && audio) {
      const audioProbeError = await probeRapidStream(audio, "RapidAPI audio");
      if (audioProbeError) return { err: audioProbeError, status: 502 };
    }

    return {
      ok: {
        videoId,
        title: data.title ?? "YouTube video",
        durationSec,
        streamUrl: `/api/public/yt-proxy?id=${encodeURIComponent(videoId)}&kind=video`,
        audioUrl: needsAudio ? `/api/public/yt-proxy?id=${encodeURIComponent(videoId)}&kind=audio` : undefined,
        mimeType: video.metadata?.mime_type ?? "video/mp4",
        quality: height ? `${height}p` : "720p",
        thumbnail: data.thumbnail ?? data.thumbnails?.[0]?.url,
        source: "rapidapi",
      },
    };
  } catch (e) {
    console.error("[rapidapi] fetch threw", e);
    return { err: `RapidAPI network error: ${(e as Error).message}`, status: 502 };
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
        const modalResult = await resolveWithModal(videoId, cleanYtUrlEarly);
        if (modalResult && "ok" in modalResult) return Response.json(modalResult.ok);

        const rapidResult = await resolveWithRapidApi(videoId);
        if (rapidResult && "ok" in rapidResult) return Response.json(rapidResult.ok);

        const apifyResult = await resolveWithApify(videoId, cleanYtUrlEarly);
        if (apifyResult && "ok" in apifyResult) return Response.json(apifyResult.ok);

        const modalErr = modalResult && "err" in modalResult ? modalResult.err : "Modal not configured";
        const rapidErr = rapidResult && "err" in rapidResult ? rapidResult.err : "RapidAPI not configured";
        const apifyErr = apifyResult && "err" in apifyResult ? apifyResult.err : "Apify not configured";
        const upstreamStatus =
          (apifyResult && "err" in apifyResult ? apifyResult.status : undefined) ??
          (rapidResult && "err" in rapidResult ? rapidResult.status : undefined) ??
          (modalResult && "err" in modalResult ? modalResult.status : undefined) ??
          503;

        // YouTube/Modal failures are expected operational failures, not app crashes.
        // Return 200 so the UI can render its existing fallback/workaround panel instead
        // of the preview treating the API response as an unhandled 5xx runtime error.
        return Response.json(
          {
            error: `${modalErr}; ${rapidErr}; ${apifyErr}`,
            setupRequired: true,
            setupMessage:
              "All YouTube resolvers failed. Check Modal token/cookies, RapidAPI, or Apify, then retry.",
            upstreamStatus,
            source: "modal+rapidapi+apify",
            retryable: true,
          },
          { status: 200, headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});

