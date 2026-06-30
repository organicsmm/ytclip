import httpx
import json
import logging
from app.config import settings

logger = logging.getLogger("ai_gateway")

async def pick_viral_clips(title: str, duration_sec: float, transcript: list[dict], count: int) -> list[dict]:
    """
    Calls the Google Gemini 2.0 Flash API directly to select viral clips.
    Falls back to evenly-spaced clips on error or empty results.
    """
    if not settings.GEMINI_API_KEY:
        logger.warning("GEMINI_API_KEY is not configured. Falling back to default clips.")
        return get_fallback_clips(duration_sec, count)
        
    count = min(max(count, 1), 8)
    min_len = 20
    max_len = 25
    
    # Format transcript for the prompt
    transcript_text = "\n".join(f"[{int(s.get('start', 0))}s] {s.get('text', '')}" for s in transcript)
    
    system_prompt = (
        f"You are a viral short-form video editor. Given a long-form video's title, total duration in seconds, "
        f"and transcript, pick {count} non-overlapping clip candidates that would perform on TikTok/Reels/Shorts. "
        f"Each clip must be {min_len}-{max_len}s. Return STRICT JSON only."
    )
    
    user_prompt = f"""Video Title: "{title}"
Total Duration: {int(duration_sec)} seconds.
Transcript:
{transcript_text}

Return JSON of the exact shape:
{{ "clips": [ {{ "title": string (max 60 chars, hooky), "hook": string (one sentence, max 140 chars), "hashtags": string[] (4 hashtags w/ #), "start_time": integer seconds, "end_time": integer seconds, "score": integer 70-99 }} ] }}

Rules:
- start_time >= 0 and end_time <= {int(duration_sec)}.
- end_time - start_time between {min_len} and {max_len}.
- Clips must not overlap and should be spread across the video timeline.
- Sort by score descending.
"""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={settings.GEMINI_API_KEY}"
    
    payload = {
        "systemInstruction": {
            "parts": [
                {
                    "text": system_prompt
                }
            ]
        },
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": user_prompt
                    }
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2
        }
    }

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                url,
                headers={"Content-Type": "application/json"},
                json=payload
            )
            response.raise_for_status()
            res_data = response.json()
            
            # Extract content from Gemini response
            candidates = res_data.get("candidates", [])
            if not candidates:
                logger.warning("Gemini returned no candidates. Falling back.")
                return get_fallback_clips(duration_sec, count)
                
            content_parts = candidates[0].get("content", {}).get("parts", [])
            if not content_parts:
                logger.warning("Gemini returned empty parts. Falling back.")
                return get_fallback_clips(duration_sec, count)
                
            content_text = content_parts[0].get("text", "{}")
            parsed = json.loads(content_text)
            raw_clips = parsed.get("clips", [])
            
            # Validate and sanitize clips
            valid_clips = []
            for c in raw_clips:
                start = c.get("start_time")
                end = c.get("end_time")
                
                if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
                    continue
                if start < 0 or end <= start or start >= duration_sec:
                    continue
                    
                # Cap end time to max clip duration
                end = min(end, start + max_len, duration_sec)
                if end - start < min_len:
                    continue
                    
                valid_clips.append({
                    "title": str(c.get("title", f"Highlight @ {int(start)}s")),
                    "hook": str(c.get("hook", "A standout moment auto-selected from your video.")),
                    "hashtags": [str(h) for h in c.get("hashtags", ["#shorts", "#viral"])],
                    "start_time": int(start),
                    "end_time": int(end),
                    "score": int(c.get("score", 80))
                })
            
            if not valid_clips:
                logger.warning("No valid clips parsed from Gemini output. Falling back.")
                return get_fallback_clips(duration_sec, count)
                
            return valid_clips[:count]
            
    except Exception as e:
        logger.error(f"Gemini API error: {e}. Falling back to default clips.")
        return get_fallback_clips(duration_sec, count)

def get_fallback_clips(duration_sec: float, count: int) -> list[dict]:
    min_len = 20
    max_len = 25
    fallback = []
    slot = max(40, int(duration_sec // (count + 1)))
    
    for i in range(count):
        start = int(((i + 1) * duration_sec) / (count + 2))
        end = min(int(duration_sec), start + min(slot, max_len))
        if end - start < min_len:
            continue
        fallback.append({
            "title": f"Highlight {i + 1}",
            "hook": "A standout moment auto-selected from your video.",
            "hashtags": ["#shorts", "#viral", "#fyp", "#clip"],
            "start_time": start,
            "end_time": end,
            "score": 80 - i * 3
        })
    return fallback
