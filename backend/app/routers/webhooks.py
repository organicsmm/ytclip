import hmac
import hashlib
import json
import logging
import asyncio
from fastapi import APIRouter, Header, HTTPException, Request, Response
from app.config import settings
from supabase import create_client

logger = logging.getLogger("webhooks_router")
router = APIRouter()

def verify_paddle_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    if not signature_header:
        return False
        
    parts = {}
    for part in signature_header.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            parts[k.strip()] = v.strip()
            
    if "ts" not in parts or "h1" not in parts:
        return False
        
    ts = parts["ts"]
    h1 = parts["h1"]
    
    # Calculate HMAC SHA256 of ts:raw_body
    msg = f"{ts}:".encode("utf-8") + raw_body
    expected = hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).hexdigest()
    
    return hmac.compare_digest(h1, expected)

def price_id_to_plan(price_id: str | None) -> str:
    if not price_id:
        return "free"
    if price_id == settings.PADDLE_PRICE_STARTER:
        return "starter"
    if price_id == settings.PADDLE_PRICE_PRO:
        return "pro"
    return "free"

def upsert_subscription_rpc(user_id: str, plan: str, status: str, paddle_sub_id: str, period_end: str | None):
    # Using Security Definere Postgres RPC function via anon client to bypass RLS
    client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
    client.rpc("handle_paddle_webhook_subscription", {
        "_user_id": user_id,
        "_plan": plan,
        "_status": status,
        "_paddle_sub_id": paddle_sub_id,
        "_period_end": period_end
    }).execute()

@router.post("/api/public/paddle-webhook")
async def paddle_webhook(request: Request):
    secret = settings.PADDLE_WEBHOOK_SECRET
    if not secret:
        logger.error("PADDLE_WEBHOOK_SECRET is not configured.")
        return Response(content="Webhook secret not configured", status_code=500)
        
    raw_body = await request.body()
    signature_header = request.headers.get("paddle-signature")
    
    if not signature_header or not verify_paddle_signature(raw_body, signature_header, secret):
        logger.warning("Paddle webhook signature validation failed.")
        raise HTTPException(status_code=401, detail="Invalid signature")
        
    try:
        event = json.loads(raw_body)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
        
    event_type = event.get("event_type", "")
    data = event.get("data", {})
    
    custom_data = data.get("custom_data") or {}
    user_id = custom_data.get("user_id") or custom_data.get("userId")
    paddle_sub_id = data.get("id")
    
    if not user_id:
        logger.warning(f"Paddle webhook event {event_type} ignored because custom_data.user_id is missing.")
        return {"status": "ignored"}
        
    # Extract subscription details
    items = data.get("items", [])
    price_id = None
    if items and isinstance(items, list):
        price = items[0].get("price") or {}
        price_id = price.get("id")
        
    plan = price_id_to_plan(price_id)
    status = str(data.get("status", "active")).lower()
    
    billing_period = data.get("current_billing_period") or {}
    period_end = billing_period.get("ends_at") or data.get("next_billed_at")
    
    logger.info(f"Processing Paddle webhook: {event_type} for user {user_id}. Status: {status}, Plan: {plan}")
    
    try:
        if event_type in [
            "subscription.created", "subscription.activated", 
            "subscription.updated", "subscription.resumed", 
            "subscription.trialing", "subscription.past_due", 
            "subscription.paused"
        ]:
            db_plan = plan if status in ["active", "trialing"] else "free"
            await asyncio.to_thread(upsert_subscription_rpc, user_id, db_plan, status, paddle_sub_id, period_end)
            
        elif event_type == "subscription.canceled":
            await asyncio.to_thread(upsert_subscription_rpc, user_id, "free", "canceled", paddle_sub_id, period_end)
            
        else:
            logger.info(f"Acknowledge unhandled event type: {event_type}")
            
    except Exception as e:
        logger.error(f"Failed to write subscription to database: {e}", exc_info=True)
        return Response(content="DB write failed", status_code=500)
        
    return {"status": "ok"}
