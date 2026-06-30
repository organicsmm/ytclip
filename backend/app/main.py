from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.routers import videos, pipeline, billing, webhooks
import uvicorn

app = FastAPI(
    title="AutoCliper API",
    description="Python backend orchestrator for AutoCliper YouTube to viral shorts clipper",
    version="1.0.0"
)

# CORS setup
origins = [
    settings.FRONTEND_ORIGIN,
    "http://localhost:5173",
    "http://localhost:3000",
]

# Filter out empty entries and deduplicate
origins = list(set([o for o in origins if o]))

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include Routers
app.include_router(videos.router)
app.include_router(pipeline.router)
app.include_router(billing.router)
app.include_router(webhooks.router)

@app.get("/health")
def health():
    return {"status": "healthy", "ok": True}

if __name__ == "__main__":
    uvicorn.run("app.main:app", host="0.0.0.0", port=settings.PORT, reload=True)
