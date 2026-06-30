import { createFileRoute } from "@tanstack/react-router";
import { Innertube } from "youtubei.js/cf-worker";

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
          const yt = await Innertube.create({
            generate_session_locally: true,
          });
          const info = await yt.getBasicInfo(videoId);

          // YouTube currently bot-blocks all anonymous extraction methods
          const status = info.playability_status?.status;
          if (status && status !== "OK") {
            const reason = info.playability_status?.reason ?? status;
            return Response.json({
              error: `YouTube blocked extraction (${status}: ${reason}). All free public resolvers are currently bot-walled. Please download the MP4 manually and use Local Upload.`,
            });
          }

          // Try progressive (audio+video) first — modern videos rarely have these above 360p
          let chosen: { url?: string; mime_type?: string; height?: number; decipher?: (p: unknown) => string | Promise<string> } | undefined;
          try {
            chosen = info.chooseFormat({
              type: "video+audio",
              quality: "best",
              format: "mp4",
            }) as typeof chosen;
          } catch {
            // Fallback: best video-only mp4 (browser will lack audio — acceptable)
            const formats = info.streaming_data?.adaptive_formats ?? [];
            chosen = formats
              .filter((f) => (f.mime_type || "").toLowerCase().includes("video/mp4"))
              .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0] as typeof chosen;
          }

          let streamUrl = chosen?.url ?? "";
          if (chosen && !streamUrl && chosen.decipher) {
            try {
              streamUrl = await chosen.decipher(yt.session.player);
            } catch {
              /* fall through */
            }
          }

          if (!chosen || !streamUrl) {
            return Response.json({
              error:
                "No playable mp4 stream available for this video (it may be live, age-restricted, or members-only).",
            });
          }

          return Response.json({
            videoId,
            title: info.basic_info.title ?? "YouTube video",
            durationSec: info.basic_info.duration ?? 0,
            streamUrl,
            mimeType: chosen.mime_type?.split(";")[0] || "video/mp4",
            quality: `${chosen.height ?? "?"}p`,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Failed to resolve";
          return Response.json({ error: `InnerTube error: ${msg}` });
        }
      },
    },
  },
});
