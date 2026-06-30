import httpx
from app.config import settings
from fastapi import HTTPException

async def render_clip(
    source_url: str,
    start: float,
    end: float,
    aspect_ratio: str,
    subtitle_style: str,
    transcript_window: list[dict]
) -> bytes:
    """
    Calls the Modal render service to trim a clip, crop aspect ratio,
    and burn styled subtitles. Returns raw MP4 bytes.
    """
    if not settings.MODAL_RENDER_URL:
        raise HTTPException(status_code=500, detail="MODAL_RENDER_URL is not configured")
        
    headers = {}
    if settings.MODAL_AUTH_TOKEN:
        headers["Authorization"] = f"Bearer {settings.MODAL_AUTH_TOKEN}"
        
    async with httpx.AsyncClient(timeout=600) as client:
        try:
            response = await client.post(
                f"{settings.MODAL_RENDER_URL}/render",
                json={
                    "source_url": source_url,
                    "start": start,
                    "end": end,
                    "aspect_ratio": aspect_ratio,
                    "subtitle_style": subtitle_style,
                    "transcript": transcript_window
                },
                headers=headers
            )
            response.raise_for_status()
            return response.content
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"Modal render service error: {e.response.text}"
            )
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to reach Modal render service: {str(e)}"
            )

async def probe_duration(source_url: str) -> float:
    """
    Calls the Modal render service's /probe endpoint to retrieve the video
    duration using ffprobe on Modal (to avoid running ffprobe on Railway).
    """
    if not settings.MODAL_RENDER_URL:
        raise HTTPException(status_code=500, detail="MODAL_RENDER_URL is not configured")
        
    headers = {}
    if settings.MODAL_AUTH_TOKEN:
        headers["Authorization"] = f"Bearer {settings.MODAL_AUTH_TOKEN}"
        
    async with httpx.AsyncClient(timeout=60) as client:
        try:
            response = await client.post(
                f"{settings.MODAL_RENDER_URL}/probe",
                json={"source_url": source_url},
                headers=headers
            )
            response.raise_for_status()
            return float(response.json().get("duration_sec", 0.0))
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"Modal probe service error: {e.response.text}"
            )
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to reach Modal probe service: {str(e)}"
            )
