import httpx
from fastapi import Header, HTTPException, Depends
from app.config import settings

def get_auth_token(authorization: str | None = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return authorization.removeprefix("Bearer ").strip()

async def get_current_user(token: str = Depends(get_auth_token)) -> str:
    """
    Validates the user token by contacting the Supabase Auth server directly.
    This eliminates the need for a local SUPABASE_JWT_SECRET.
    Returns the Supabase user_id.
    """
    if not settings.SUPABASE_URL or not settings.SUPABASE_ANON_KEY:
        raise HTTPException(status_code=500, detail="Supabase URL or Anon key is not configured")
        
    url = f"{settings.SUPABASE_URL}/auth/v1/user"
    headers = {
        "apikey": settings.SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {token}"
    }
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(url, headers=headers)
            if response.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid session token or session expired")
            data = response.json()
            return data["id"]  # Returns user_id
        except httpx.HTTPError as e:
            raise HTTPException(status_code=401, detail=f"Session authentication failed: {str(e)}")
