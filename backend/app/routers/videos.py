import uuid
import json
import httpx
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks, UploadFile
from typing import Optional, Literal
from pydantic import BaseModel
from app.config import settings
from app.auth import get_current_user, get_auth_token
from app.supabase_client import get_user_client

logger = logging.getLogger("videos_router")
router = APIRouter()

class PipelineConfigModel(BaseModel):
    aspect_ratio: Literal["9:16", "1:1"]
    subtitle_style: Literal["tiktok", "minimalist", "podcast"]
    face_tracking: bool
    clip_count: Optional[int] = 5

class CreateVideoRequest(BaseModel):
    title: str
    source_url: Optional[str] = None
    source_type: Literal["youtube", "upload"]
    config: PipelineConfigModel

async def trigger_pipeline_run(video_id: str, token: str):
    """
    Triggers the internal pipeline run endpoint.
    If it fails, runs the pipeline orchestrator directly as a fallback.
    """
    url = f"http://127.0.0.1:{settings.PORT}/api/internal/pipeline/run"
    headers = {"X-Internal-Secret": settings.INTERNAL_PIPELINE_SECRET}
    
    async with httpx.AsyncClient() as client:
        try:
            res = await client.post(url, json={"video_id": video_id, "token": token}, headers=headers, timeout=10.0)
            res.raise_for_status()
            logger.info(f"Successfully triggered pipeline for video {video_id} via HTTP endpoint.")
        except Exception as e:
            logger.warning(f"Failed to trigger pipeline via HTTP: {e}. Executing directly.")
            # Direct invocation fallback
            from app.tasks.pipeline import run_pipeline
            asyncio.create_task(run_pipeline(video_id, token))

@router.post("/api/videos", status_code=201)
async def create_video(
    request: Request,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_current_user),
    token: str = Depends(get_auth_token)
):
    content_type = request.headers.get("content-type", "")
    video_id = str(uuid.uuid4())
    
    # 1. Parse Request (supports JSON or multipart/form-data)
    if "application/json" in content_type:
        try:
            body = await request.json()
            req_data = CreateVideoRequest(**body)
            title = req_data.title
            source_url = req_data.source_url
            source_type = req_data.source_type
            config = req_data.config.model_dump()
        except Exception as e:
            raise HTTPException(status_code=422, detail=f"Invalid JSON schema: {str(e)}")
            
    elif "multipart/form-data" in content_type:
        try:
            form = await request.form()
            title = form.get("title", "Uploaded Video")
            source_type = "upload"
            
            # Parse config from JSON string
            config_str = form.get("config", "{}")
            config_data = json.loads(config_str)
            config = {
                "aspect_ratio": config_data.get("aspect_ratio", "9:16"),
                "subtitle_style": config_data.get("subtitle_style", "tiktok"),
                "face_tracking": config_data.get("face_tracking", False),
                "clip_count": int(config_data.get("clip_count", 5))
            }
            
            # Get file upload
            file = form.get("file")
            if not isinstance(file, UploadFile):
                raise HTTPException(status_code=400, detail="Missing file parameter in upload request")
                
            file_bytes = await file.read()
            ext = file.filename.split(".")[-1] if "." in file.filename else "mp4"
            source_url = f"{user_id}/{video_id}/source.{ext}"
            
            # Upload source file to Supabase storage uploads bucket using User Client
            user_client = get_user_client(token)
            def upload_fn():
                try:
                    user_client.storage.from_("uploads").upload(
                        source_url, 
                        file_bytes, 
                        file_options={"content-type": file.content_type or "video/mp4", "upsert": "true"}
                    )
                except TypeError:
                    try:
                        user_client.storage.from_("uploads").upload(
                            source_url, 
                            file_bytes, 
                            options={"content-type": file.content_type or "video/mp4", "upsert": "true"}
                        )
                    except Exception:
                        user_client.storage.from_("uploads").upload(source_url, file_bytes)
                        
            await asyncio.to_thread(upload_fn)
            
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid form upload request: {str(e)}")
    else:
        raise HTTPException(status_code=415, detail="Content-Type must be application/json or multipart/form-data")
        
    # 2. Check and Increment Quota
    user_client = get_user_client(token)
    def check_quota_fn():
        res = user_client.rpc("increment_video_usage", {"_user_id": user_id}).execute()
        return res.data[0] if isinstance(res.data, list) else res.data
        
    try:
        quota_row = await asyncio.to_thread(check_quota_fn)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to check usage quota: {str(e)}")
        
    if not quota_row or not quota_row.get("allowed", False):
        raise HTTPException(status_code=402, detail="Quota limit reached for this month. Please upgrade your plan.")
        
    # 3. Create Video Database Entry (using User client to respect RLS)
    def insert_video_fn():
        user_client.table("videos").insert({
            "id": video_id,
            "user_id": user_id,
            "title": title,
            "source_url": source_url,
            "source_type": source_type,
            "status": "processing",
            "stage": "queued",
            "progress": 0,
            "log_lines": ["🚀 AutoCliper pipeline starting…"],
            "config": config,
            "error": None
        }).execute()
        
    try:
        await asyncio.to_thread(insert_video_fn)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to initialize video row: {str(e)}")
        
    # 4. Trigger the orchestrator asynchronously, propagating the token
    background_tasks.add_task(trigger_pipeline_run, video_id, token)
    
    return {"video_id": video_id}

@router.get("/api/videos/{video_id}")
async def get_video(
    video_id: str,
    user_id: str = Depends(get_current_user),
    token: str = Depends(get_auth_token)
):
    user_client = get_user_client(token)
    
    def fetch_video_and_clips():
        # Query video row (scopes to owner via RLS)
        v_res = user_client.table("videos").select("*").eq("id", video_id).maybe_single().execute()
        if not v_res.data:
            return None, None
            
        # Query clips row (scopes to owner via RLS)
        c_res = user_client.table("clips").select("*").eq("video_id", video_id).order("score", desc=True).execute()
        return v_res.data, c_res.data
        
    video, clips = await asyncio.to_thread(fetch_video_and_clips)
    if not video:
        raise HTTPException(status_code=404, detail="Video not found or access denied")
        
    # Return matched format
    response_data = dict(video)
    response_data["clips"] = clips or []
    return response_data
