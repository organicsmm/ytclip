import { z } from "zod";

/** Accepted video MIME types and file extensions for upload. */
export const ACCEPTED_VIDEO_MIME = [
  "video/mp4",
  "video/quicktime", // .mov
  "video/x-matroska", // .mkv
  "video/webm",
  "video/x-m4v",
] as const;

export const ACCEPTED_VIDEO_EXT = ["mp4", "mov", "mkv", "webm", "m4v"] as const;

/** Hard cap so ffmpeg.wasm doesn't OOM the tab. */
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB

const youtubeHostnames = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

/** Returns the 11-char YouTube video ID, or null if the URL isn't a valid YT link. */
export function parseYouTubeId(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (!youtubeHostnames.has(url.hostname.toLowerCase())) return null;

  let id: string | null = null;
  if (url.hostname.includes("youtu.be")) {
    id = url.pathname.slice(1).split("/")[0] || null;
  } else if (url.pathname.startsWith("/shorts/")) {
    id = url.pathname.split("/")[2] || null;
  } else if (url.pathname.startsWith("/embed/")) {
    id = url.pathname.split("/")[2] || null;
  } else {
    id = url.searchParams.get("v");
  }
  if (!id) return null;
  return /^[\w-]{11}$/.test(id) ? id : null;
}

export const youtubeUrlSchema = z
  .string()
  .trim()
  .nonempty({ message: "Paste a YouTube URL first." })
  .max(2048, { message: "URL is too long." })
  .refine((v) => parseYouTubeId(v) !== null, {
    message: "That doesn't look like a valid YouTube link. Try a youtube.com/watch?v=… or youtu.be/… URL.",
  });

export const videoFileSchema = z
  .instanceof(File, { message: "Choose a video file to upload." })
  .refine((f) => f.size > 0, { message: "This file is empty." })
  .refine((f) => f.size <= MAX_VIDEO_BYTES, {
    message: `Video is over ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB. Trim or re-encode and try again.`,
  })
  .refine(
    (f) => {
      const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
      const mimeOk = ACCEPTED_VIDEO_MIME.includes(f.type as (typeof ACCEPTED_VIDEO_MIME)[number]);
      const extOk = ACCEPTED_VIDEO_EXT.includes(ext as (typeof ACCEPTED_VIDEO_EXT)[number]);
      return mimeOk || extOk;
    },
    { message: "Unsupported format. Use MP4, MOV, MKV, WEBM, or M4V." },
  );

/** Returns the first zod error message, or a generic fallback. */
export function firstError(err: unknown, fallback = "Invalid input"): string {
  if (err instanceof z.ZodError) {
    return err.issues[0]?.message ?? fallback;
  }
  return err instanceof Error ? err.message : fallback;
}
