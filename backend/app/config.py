import os
from dotenv import load_dotenv

# Load local .env file if it exists
load_dotenv()

class Settings:
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "")
    
    MODAL_YT_URL: str = os.getenv("MODAL_YT_URL", "")
    MODAL_WHISPER_URL: str = os.getenv("MODAL_WHISPER_URL", "")
    MODAL_RENDER_URL: str = os.getenv("MODAL_RENDER_URL", "")
    MODAL_AUTH_TOKEN: str = os.getenv("MODAL_AUTH_TOKEN", "")
    
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    INTERNAL_PIPELINE_SECRET: str = os.getenv("INTERNAL_PIPELINE_SECRET", "")
    
    PADDLE_WEBHOOK_SECRET: str = os.getenv("PADDLE_WEBHOOK_SECRET", "")
    PADDLE_PRICE_STARTER: str = os.getenv("PADDLE_PRICE_STARTER", "")
    PADDLE_PRICE_PRO: str = os.getenv("PADDLE_PRICE_PRO", "")
    
    FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
    PORT: int = int(os.getenv("PORT", "8080"))

settings = Settings()
