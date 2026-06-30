/**
 * Lightweight client-side probe to confirm that a downloaded video Blob
 * actually carries an audio stream. Works for both MP4 (ISO-BMFF) and WebM
 * (Matroska/EBML) by combining:
 *
 *  1. A byte-level signature scan for known audio codec FourCCs / codec IDs.
 *  2. A playback-based fallback that asks the browser whether any audio
 *     samples were decoded.
 *
 * Returns `{ hasAudio: true }` when at least one check passes.
 */
export type AudioProbeResult = {
  hasAudio: boolean;
  codec: string | null;
  reason: string;
};

const MP4_AUDIO_CODECS = ["mp4a", "Opus", "ac-3", "ec-3", ".mp3"];
const WEBM_AUDIO_CODECS = ["A_OPUS", "A_VORBIS", "A_AAC", "A_MPEG"];

function scanForCodec(bytes: Uint8Array, needles: string[]): string | null {
  const text = new TextDecoder("latin1").decode(bytes);
  for (const n of needles) {
    if (text.includes(n)) return n;
  }
  return null;
}

async function signatureProbe(blob: Blob): Promise<string | null> {
  // First ~2 MB is enough to land past the `moov` / Tracks element in
  // faststart-muxed MP4 and typical WebM.
  const slice = blob.slice(0, Math.min(blob.size, 2 * 1024 * 1024));
  const buf = new Uint8Array(await slice.arrayBuffer());
  return scanForCodec(buf, [...MP4_AUDIO_CODECS, ...WEBM_AUDIO_CODECS]);
}

async function playbackProbe(blob: Blob): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  video.style.position = "fixed";
  video.style.left = "-9999px";
  video.style.width = "1px";
  video.style.height = "1px";
  document.body.appendChild(video);

  try {
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error("metadata timeout")), 4000);
      video.onloadedmetadata = () => {
        window.clearTimeout(t);
        resolve();
      };
      video.onerror = () => {
        window.clearTimeout(t);
        reject(new Error("metadata error"));
      };
    });

    type AudioCapableVideo = HTMLVideoElement & {
      mozHasAudio?: boolean;
      webkitAudioDecodedByteCount?: number;
      audioTracks?: { length: number };
    };
    const v = video as AudioCapableVideo;

    if (v.mozHasAudio) return true;
    if (typeof v.audioTracks?.length === "number" && v.audioTracks.length > 0) return true;

    // webkitAudioDecodedByteCount only increments after playback starts.
    try {
      await video.play();
      await new Promise((r) => window.setTimeout(r, 350));
      video.pause();
      if (typeof v.webkitAudioDecodedByteCount === "number" && v.webkitAudioDecodedByteCount > 0) {
        return true;
      }
    } catch {
      /* autoplay blocked → fall through */
    }
    return false;
  } finally {
    video.removeAttribute("src");
    video.remove();
    URL.revokeObjectURL(url);
  }
}

export async function probeAudio(blob: Blob): Promise<AudioProbeResult> {
  try {
    const codec = await signatureProbe(blob);
    if (codec) return { hasAudio: true, codec, reason: `signature:${codec}` };
  } catch {
    /* fall through */
  }
  try {
    const ok = await playbackProbe(blob);
    if (ok) return { hasAudio: true, codec: null, reason: "playback" };
  } catch {
    /* fall through */
  }
  return { hasAudio: false, codec: null, reason: "no audio stream detected" };
}
