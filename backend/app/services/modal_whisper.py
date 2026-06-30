import httpx
from app.config import settings
from fastapi import HTTPException

async def transcribe(source_url: str) -> list[dict]:
    """
    Calls the Modal Whisper service to transcribe a video.
    Returns: list of segments, e.g. [{"start": float, "end": float, "text": str}]
    """
    if not settings.MODAL_WHISPER_URL:
        raise HTTPException(status_code=500, detail="MODAL_WHISPER_URL is not configured")
        
    headers = {}
    if settings.MODAL_AUTH_TOKEN:
        headers["Authorization"] = f"Bearer {settings.MODAL_AUTH_TOKEN}"
        
    async with httpx.AsyncClient(timeout=900) as client:
        try:
            response = await client.post(
                f"{settings.MODAL_WHISPER_URL}/transcribe",
                json={"source_url": source_url},
                headers=headers
            )
            response.raise_for_status()
            return response.json().get("segments", [])
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"Modal whisper service error: {e.response.text}"
            )
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to reach Modal whisper service: {str(e)}"
            )
