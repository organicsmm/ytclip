from pydantic import BaseModel
from typing import Optional, List, Literal

class ClipRow(BaseModel):
    id: str
    video_id: str
    title: str
    start_time: float
    end_time: float
    score: float
    hook: Optional[str] = None
    video_url: Optional[str] = None
    hashtags: List[str] = []
    aspect_ratio: Literal["9:16", "1:1"]
    created_at: str
