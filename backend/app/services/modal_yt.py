import httpx
from app.config import settings
from fastapi import HTTPException

async def download(url: str) -> dict:
    """
    Calls the Modal yt-download /info endpoint to resolve YouTube URL,
    trigger download/cache on Modal, and return video metadata with signed stream URL.
    """
    if not settings.MODAL_YT_URL:
        raise HTTPException(status_code=500, detail="MODAL_YT_URL is not configured")
        
    headers = {}
    if settings.MODAL_AUTH_TOKEN:
        headers["Authorization"] = f"Bearer {settings.MODAL_AUTH_TOKEN}"
        
    async with httpx.AsyncClient(timeout=900) as client:
        try:
            response = await client.get(
                f"{settings.MODAL_YT_URL}/info",
                params={"url": url},
                headers=headers
            )
            response.raise_for_status()
            data = response.json()
            
            # Convert relative stream_path to absolute stream_url
            stream_path = data.get("stream_path", "")
            data["stream_url"] = f"{settings.MODAL_YT_URL}{stream_path}"
            return data
        except httpx.HTTPStatusError as e:
            raise HTTPException(
                status_code=e.response.status_code,
                detail=f"Modal yt-download service error: {e.response.text}"
            )
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to reach Modal yt-download service: {str(e)}"
            )
