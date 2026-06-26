import { createServerFn } from "@tanstack/react-start";

interface ClipSuggestion {
  title: string;
  hook: string;
  hashtags: string[];
  start_time: number;
  end_time: number;
  score: number;
}

/**
 * Generates viral clip suggestions using the Lovable AI Gateway (free tier:
 * google/gemini-2.5-flash). Given a video title + total duration, returns N
 * timestamp ranges with viral-ready titles, hooks, and hashtags.
 */
export const generateClipSuggestions = createServerFn({ method: "POST" })
  .inputValidator((input: { title: string; durationSec: number; count: number }) => input)
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY is not configured");

    const count = Math.min(Math.max(data.count, 1), 8);
    const minLen = 20;
    const maxLen = 55;

    const system = `You are a viral short-form video editor. Given a long-form video's title and total duration in seconds, output ${count} non-overlapping clip candidates that would perform on TikTok/Reels/Shorts. Each clip is ${minLen}-${maxLen}s. Return STRICT JSON only.`;
    const user = `Video title: "${data.title}"
Total duration: ${Math.floor(data.durationSec)} seconds.

Return JSON of the exact shape:
{ "clips": [ { "title": string (max 60 chars, hooky), "hook": string (one sentence, max 140 chars), "hashtags": string[] (4 hashtags w/ #), "start_time": integer seconds, "end_time": integer seconds, "score": integer 70-99 } ] }

Rules:
- start_time >= 0 and end_time <= ${Math.floor(data.durationSec)}.
- end_time - start_time between ${minLen} and ${maxLen}.
- Clips must not overlap and should be spread across the video.
- Sort by score descending.`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`AI gateway ${res.status}: ${body.slice(0, 200)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = json.choices?.[0]?.message?.content ?? "{}";
    let parsed: { clips?: ClipSuggestion[] };
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error("AI returned non-JSON content");
    }

    const clips = (parsed.clips ?? []).filter(
      (c) =>
        typeof c.start_time === "number" &&
        typeof c.end_time === "number" &&
        c.end_time > c.start_time &&
        c.end_time <= data.durationSec,
    );

    if (clips.length === 0) {
      // Fallback: evenly spaced 40s clips
      const fallback: ClipSuggestion[] = [];
      const slot = Math.max(40, Math.floor(data.durationSec / (count + 1)));
      for (let i = 0; i < count; i++) {
        const start = Math.floor(((i + 1) * data.durationSec) / (count + 2));
        const end = Math.min(data.durationSec, start + Math.min(slot, 50));
        if (end - start < minLen) continue;
        fallback.push({
          title: `Highlight ${i + 1}`,
          hook: "A standout moment auto-selected from your video.",
          hashtags: ["#shorts", "#viral", "#fyp", "#clip"],
          start_time: start,
          end_time: end,
          score: 80 - i * 3,
        });
      }
      return { clips: fallback };
    }

    return { clips: clips.slice(0, count) };
  });
