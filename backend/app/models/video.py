from pydantic import BaseModel
from typing import Optional, Literal, List

class PipelineConfig(BaseModel):
    aspect_ratio: Literal["9:16", "1:1"]
    subtitle_style: Literal["tiktok", "minimalist", "podcast"]
    face_tracking: bool
    clip_count: Optional[int] = 5

class VideoRow(BaseModel):
    id: str
    user_id: str
    title: str
    source_url: Optional[str] = None
    source_type: Literal["youtube", "upload"]
    status: Literal["processing", "completed", "failed"]
    stage: Literal["queued", "downloading", "transcribing", "chunking", "selecting", "rendering", "completed", "failed"]
    progress: float
    log_lines: List[str] = []
    config: PipelineConfig
    error: Optional[str] = None
    created_at: str
    updated_at: str
