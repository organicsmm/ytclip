import logging
from fastapi import APIRouter, HTTPException, Header, BackgroundTasks
from pydantic import BaseModel
from app.config import settings
from app.tasks.pipeline import run_pipeline

logger = logging.getLogger("pipeline_router")
router = APIRouter()

class PipelineRunRequest(BaseModel):
    video_id: str
    token: str  # Propagated user JWT token to authenticate background DB operations

@router.post("/api/internal/pipeline/run", status_code=202)
async def trigger_pipeline(
    req: PipelineRunRequest,
    background_tasks: BackgroundTasks,
    x_internal_secret: str | None = Header(None)
):
    # Verify internal secret to prevent unauthorized external trigger calls
    if not settings.INTERNAL_PIPELINE_SECRET or x_internal_secret != settings.INTERNAL_PIPELINE_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized access to internal pipeline trigger")
        
    logger.info(f"Accepted internal request to trigger pipeline for video {req.video_id}")
    background_tasks.add_task(run_pipeline, req.video_id, req.token)
    return {"status": "accepted"}
