from pydantic import BaseModel
from typing import Optional, Literal

class QuotaResponse(BaseModel):
    plan: Literal["free", "starter", "pro"]
    status: str
    used: int
    monthly_limit: int
    period_month: str
    current_period_end: Optional[str] = None
    paddle_subscription_id: Optional[str] = None
