from supabase import create_client, Client
from app.config import settings
from fastapi import HTTPException

def get_user_client(token: str) -> Client:
    if not settings.SUPABASE_URL or not settings.SUPABASE_ANON_KEY:
        raise HTTPException(
            status_code=500,
            detail="Supabase credentials (URL/Anon Key) are not configured"
        )
    client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
    # Authenticate Postgrest client with user access token
    client.postgrest.auth(token)
    return client
