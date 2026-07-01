import asyncio
from fastapi import APIRouter, Depends, HTTPException
from app.auth import get_current_user, get_auth_token
from app.supabase_client import get_user_client
from app.models.quota import QuotaResponse

router = APIRouter()

@router.get("/api/quota", response_model=QuotaResponse)
async def get_quota(
    user_id: str = Depends(get_current_user),
    token: str = Depends(get_auth_token)
):
    user_client = get_user_client(token)
    
    def fetch_quota_and_subscription():
        # Call the get_user_quota RPC
        quota_res = user_client.rpc("get_user_quota", {"_user_id": user_id}).execute()
        
        # Call the subscriptions table query
        sub_res = user_client.table("subscriptions") \
                             .select("current_period_end, paddle_subscription_id") \
                             .eq("user_id", user_id) \
                             .execute()
                             
        quota_data = quota_res.data if quota_res else None
        sub_data = sub_res.data[0] if (sub_res and sub_res.data and len(sub_res.data) > 0) else {}
        return quota_data, sub_data
        
    try:
        quota_data, sub_data = await asyncio.to_thread(fetch_quota_and_subscription)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch user quota: {str(e)}")
        
    if not quota_data:
        raise HTTPException(status_code=404, detail="No quota found for user")
        
    row = quota_data[0] if isinstance(quota_data, list) else quota_data
    sub = sub_data or {}
    
    return {
        "plan": row.get("plan", "free"),
        "status": row.get("status", "active"),
        "used": int(row.get("used", 0)),
        "monthly_limit": int(row.get("monthly_limit", 3)),
        "period_month": str(row.get("period_month", "")),
        "current_period_end": sub.get("current_period_end"),
        "paddle_subscription_id": sub.get("paddle_subscription_id")
    }
