import asyncio
import logging
from app.supabase_client import get_user_client
from app.services import modal_yt, modal_whisper, modal_render, ai_gateway

logger = logging.getLogger("pipeline")

def _get_video_sync(video_id: str, token: str) -> dict:
    client = get_user_client(token)
    res = client.table("videos").select("*").eq("id", video_id).single().execute()
    return res.data

def _set_stage_sync(video_id: str, stage: str, progress: float, token: str):
    client = get_user_client(token)
    client.table("videos").update({
        "stage": stage,
        "progress": progress,
        "status": "processing"
    }).eq("id", video_id).execute()

async def _set_stage(video_id: str, stage: str, progress: float, token: str):
    await asyncio.to_thread(_set_stage_sync, video_id, stage, progress, token)

def _log_sync(video_id: str, line: str, token: str):
    client = get_user_client(token)
    client.rpc("append_video_log", {"_video_id": video_id, "_line": line}).execute()

async def _log(video_id: str, line: str, token: str):
    logger.info(f"[{video_id}] {line}")
    await asyncio.to_thread(_log_sync, video_id, line, token)

def _get_signed_upload_url(source_key: str, token: str) -> str:
    client = get_user_client(token)
    res = client.storage.from_("uploads").create_signed_url(source_key, 3600)
    url = res.get("signedURL") or res.get("signedUrl")
    if not url:
        raise Exception(f"Failed to generate signed URL for key: {source_key}")
    return url

def _upload_clip_sync(user_id: str, video_id: str, idx: int, clip_bytes: bytes, token: str) -> str:
    client = get_user_client(token)
    path = f"{user_id}/{video_id}/clip_{idx}.mp4"
    
    # RLS-scoped storage upload using the user client
    try:
        client.storage.from_("clips").upload(
            path, 
            clip_bytes, 
            file_options={"content-type": "video/mp4", "upsert": "true"}
        )
    except TypeError:
        try:
            client.storage.from_("clips").upload(
                path, 
                clip_bytes, 
                options={"content-type": "video/mp4", "upsert": "true"}
            )
        except Exception:
            client.storage.from_("clips").upload(path, clip_bytes)
            
    # Generate 10-year signed URL for the frontend to play
    try:
        res = client.storage.from_("clips").create_signed_url(path, 315360000)
        url = res.get("signedURL") or res.get("signedUrl")
        return url or client.storage.from_("clips").get_public_url(path)
    except Exception:
        return client.storage.from_("clips").get_public_url(path)

def _insert_clip_row_sync(clip_data: dict, token: str):
    client = get_user_client(token)
    client.table("clips").insert(clip_data).execute()

def _update_video_success_sync(video_id: str, token: str):
    client = get_user_client(token)
    client.table("videos").update({
        "status": "completed",
        "stage": "completed",
        "progress": 100
    }).eq("id", video_id).execute()

def _update_video_error_sync(video_id: str, err_msg: str, token: str):
    client = get_user_client(token)
    client.table("videos").update({
        "status": "failed",
        "stage": "failed",
        "error": err_msg[:500]
    }).eq("id", video_id).execute()

def _slice_transcript(transcript: list[dict], start: float, end: float) -> list[dict]:
    sliced = []
    for s in transcript:
        s_start = s.get("start", 0.0)
        s_end = s.get("end", 0.0)
        if s_start < end and s_end > start:
            sliced.append(s)
    return sliced

async def run_pipeline(video_id: str, token: str):
    """
    Orchestrates download -> transcribe -> analyze -> render -> upload.
    Uses the user's JWT access token for all Supabase DB & Storage operations.
    """
    try:
        video = await asyncio.to_thread(_get_video_sync, video_id, token)
        if not video:
            logger.error(f"Video {video_id} not found in database or user access denied.")
            return
            
        await _log(video_id, "🚀 Starting backend processing pipeline", token)
        
        # 1. DOWNLOAD (Modal)
        await _set_stage(video_id, "downloading", 5, token)
        if video["source_type"] == "youtube":
            await _log(video_id, f"📥 Downloading YouTube video: {video['source_url']}", token)
            meta = await modal_yt.download(video["source_url"])
            source_mp4_url = meta["stream_url"]
            duration_sec = meta["duration_sec"]
            
            # Update video title with actual YouTube title if it is a generic placeholder
            resolved_title = meta.get("title")
            if resolved_title and (not video.get("title") or video.get("title") == "Untitled video" or video.get("title") == "YouTube Video"):
                def _update_title():
                    client = get_user_client(token)
                    client.table("videos").update({"title": resolved_title}).eq("id", video_id).execute()
                await asyncio.to_thread(_update_title)
                video["title"] = resolved_title
                
            await _log(video_id, f"✅ Video downloaded. Duration: {int(duration_sec)}s", token)
        else:
            # Upload flow
            source_key = video["source_url"]
            if not source_key:
                source_key = f"{video['user_id']}/{video_id}/source.mp4"
            await _log(video_id, f"📂 Locating original upload: {source_key}", token)
            source_mp4_url = await asyncio.to_thread(_get_signed_upload_url, source_key, token)
            await _log(video_id, "   Original upload located. Probing duration...", token)
            duration_sec = await modal_render.probe_duration(source_mp4_url)
            await _log(video_id, f"✅ Upload probed. Duration: {int(duration_sec)}s", token)
            
        # 2. TRANSCRIBE (Modal Whisper)
        await _set_stage(video_id, "transcribing", 25, token)
        await _log(video_id, "🗣️ Transcribing video audio (Whisper on Modal)...", token)
        transcript = await modal_whisper.transcribe(source_mp4_url)
        await _log(video_id, f"✅ Transcription complete. Found {len(transcript)} segments", token)
        
        # 3. ANALYZE / SELECT (Gemini 2.0 Flash)
        await _set_stage(video_id, "selecting", 50, token)
        await _log(video_id, "🧠 Analyzing transcript to select viral moments...", token)
        clip_count = video["config"].get("clip_count", 5)
        suggestions = await ai_gateway.pick_viral_clips(
            title=video["title"],
            duration_sec=duration_sec,
            transcript=transcript,
            count=clip_count
        )
        await _log(video_id, f"🏆 selected {len(suggestions)} clips:", token)
        for idx, sug in enumerate(suggestions):
            await _log(video_id, f"   • Clip {idx+1}: [{int(sug['start_time'])}s - {int(sug['end_time'])}s] Score: {sug['score']}% - {sug['title']}", token)
            
        # 4. RENDER & UPLOAD (in parallel)
        await _set_stage(video_id, "rendering", 65, token)
        await _log(video_id, "✂️ Rendering vertical clips (ffmpeg on Modal)...", token)
        
        async def render_and_upload(idx: int, sug: dict):
            try:
                start_t = sug["start_time"]
                end_t = sug["end_time"]
                
                # Filter transcript for the clip window
                sub_transcript = _slice_transcript(transcript, start_t, end_t)
                
                # Call Modal render to get processed MP4 bytes
                clip_bytes = await modal_render.render_clip(
                    source_url=source_mp4_url,
                    start=start_t,
                    end=end_t,
                    aspect_ratio=video["config"].get("aspect_ratio", "9:16"),
                    subtitle_style=video["config"].get("subtitle_style", "tiktok"),
                    transcript_window=sub_transcript
                )
                
                # Upload clip to storage using User Client (respects RLS)
                public_url = await asyncio.to_thread(
                    _upload_clip_sync, 
                    video["user_id"], 
                    video_id, 
                    idx, 
                    clip_bytes,
                    token
                )
                
                # Insert clip metadata row using User Client
                clip_data = {
                    "video_id": video_id,
                    "user_id": video["user_id"],
                    "title": sug["title"],
                    "hook": sug["hook"],
                    "hashtags": sug["hashtags"],
                    "score": sug["score"],
                    "start_time": start_t,
                    "end_time": end_t,
                    "video_url": public_url,
                    "aspect_ratio": video["config"].get("aspect_ratio", "9:16")
                }
                await asyncio.to_thread(_insert_clip_row_sync, clip_data, token)
                await _log(video_id, f"✅ Clip {idx+1}/{len(suggestions)} rendered and uploaded!", token)
                
            except Exception as e:
                await _log(video_id, f"⚠️ Error rendering clip {idx+1}: {str(e)}", token)
                raise
                
        # Run render/upload operations in parallel
        await asyncio.gather(*[render_and_upload(i, s) for i, s in enumerate(suggestions)])
        
        # 5. SUCCESS
        await asyncio.to_thread(_update_video_success_sync, video_id, token)
        await _log(video_id, "🎉 All clips processed successfully! Pipeline complete.", token)
        
    except Exception as e:
        logger.error(f"Pipeline failed for video {video_id}: {str(e)}", exc_info=True)
        err_msg = str(e)
        await asyncio.to_thread(_update_video_error_sync, video_id, err_msg, token)
        await _log(video_id, f"❌ Pipeline failed: {err_msg}", token)
