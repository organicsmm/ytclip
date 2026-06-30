# AutoCliper — Python Backend Port Spec

> **For AI agents (Antigravity, Cursor, Claude Code, etc.):**
> This document is a complete, self-contained specification to port the AutoCliper backend from TypeScript (TanStack Start + Lovable Cloud) to **Python (FastAPI + Modal + Supabase)**. Read this entire file before writing any code. The TypeScript frontend in `src/` stays as-is; only the **backend logic** moves to Python.

---

## 1. Goal

Build a Python backend that powers a YouTube-to-Shorts AI clipper:

1. User pastes a YouTube URL (or uploads a video) from the React frontend.
2. Backend downloads the video (via Modal).
3. Transcribes it (Whisper on Modal).
4. Asks an LLM (Lovable AI Gateway / Gemini / OpenAI) to pick top viral moments.
5. Renders vertical 9:16 clips with burned-in subtitles (ffmpeg on Modal).
6. Uploads clips to Supabase Storage.
7. Streams live progress back to the frontend via Supabase Realtime.

---

## 2. Target Architecture

```
┌────────────────┐      ┌──────────────────┐      ┌─────────────────┐
│ React Frontend │─────▶│  Railway ($5)    │─────▶│  Modal ($30)    │
│ (already done) │      │  FastAPI         │      │  yt-dlp+Whisper │
└────────┬───────┘      │  Orchestrator    │      │  +ffmpeg render │
         │              └────────┬─────────┘      └────────┬────────┘
         │                       │                         │
         │                       ▼                         ▼
         │              ┌──────────────────────────────────────┐
         └─────────────▶│   Supabase ($25)                     │
                        │   - Postgres (videos, clips, quota)  │
                        │   - Auth (JWT)                       │
                        │   - Storage (uploads/, clips/)       │
                        │   - Realtime (progress updates)      │
                        └──────────────────────────────────────┘
```

**Strict rule:** Railway only orchestrates. NEVER run yt-dlp / ffmpeg / Whisper on Railway — RAM is 512MB. All heavy work goes to Modal.

---

## 3. Tech Stack (Python)

| Component | Library | Why |
|-----------|---------|-----|
| Web framework | **FastAPI** | Async, auto OpenAPI docs, fast |
| ASGI server | **uvicorn** (gunicorn in prod) | Standard |
| Supabase client | **supabase-py** (v2) | Official |
| Modal SDK | **modal** | Already used in `modal/yt_download.py` |
| HTTP client | **httpx** (async) | For Lovable AI Gateway |
| Validation | **pydantic v2** | Type-safe request/response |
| JWT verify | **PyJWT[crypto]** | Verify Supabase auth tokens |
| Env | **python-dotenv** | Local dev |
| Logging | **structlog** | JSON logs for Railway |

`requirements.txt`:
```
fastapi==0.115.0
uvicorn[standard]==0.32.0
gunicorn==23.0.0
supabase==2.9.1
modal==0.66.0
httpx==0.27.2
pydantic==2.9.2
pyjwt[crypto]==2.9.0
python-dotenv==1.0.1
structlog==24.4.0
python-multipart==0.0.12
```

---

## 4. Repository Layout (proposed)

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI app, CORS, router mounts
│   ├── config.py               # Settings via pydantic-settings
│   ├── deps.py                 # FastAPI dependencies (auth, db)
│   ├── auth.py                 # Supabase JWT verification
│   ├── supabase_client.py      # Two clients: anon + service_role
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── videos.py           # POST /videos, GET /videos/{id}
│   │   ├── pipeline.py         # POST /pipeline/run (internal)
│   │   ├── billing.py          # GET /quota
│   │   └── webhooks.py         # Paddle webhook
│   ├── services/
│   │   ├── modal_yt.py         # Call Modal yt-download endpoint
│   │   ├── modal_whisper.py    # Call Modal whisper endpoint
│   │   ├── modal_render.py     # Call Modal ffmpeg render endpoint
│   │   ├── ai_gateway.py       # Lovable AI Gateway / Gemini calls
│   │   ├── storage.py          # Supabase storage helpers
│   │   └── progress.py         # Update videos row → triggers Realtime
│   ├── models/
│   │   ├── video.py            # Pydantic models
│   │   ├── clip.py
│   │   └── quota.py
│   └── tasks/
│       └── pipeline.py         # The main async pipeline orchestrator
├── modal_apps/
│   ├── yt_download.py          # COPY existing from modal/yt_download.py
│   ├── whisper.py              # NEW — transcription endpoint
│   └── render.py               # NEW — ffmpeg clip render endpoint
├── tests/
│   └── test_pipeline.py
├── requirements.txt
├── Procfile                    # web: gunicorn -k uvicorn.workers.UvicornWorker app.main:app
├── railway.toml                # Railway config
├── .env.example
└── README.md
```

---

## 5. Database Schema (Supabase / Postgres)

The frontend already created these tables. Python backend MUST use the same schema.

### `videos`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | `gen_random_uuid()` |
| user_id | uuid | FK to auth.users |
| title | text | |
| source_url | text nullable | YouTube URL |
| source_type | text | `'youtube'` or `'upload'` |
| status | text | `'queued' \| 'processing' \| 'done' \| 'error'` |
| stage | text | see VideoStage below |
| progress | int | 0-100 |
| log_lines | text[] | append-only log shown in terminal |
| config | jsonb | `{ aspect_ratio, subtitle_style, face_tracking, clip_count }` |
| error_message | text nullable | |
| created_at | timestamptz | default now() |

### `clips`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| video_id | uuid FK | |
| title | text | |
| start_time | int | seconds |
| end_time | int | seconds |
| score | int | 0-100 |
| hook | text | |
| hashtags | text[] | |
| video_url | text | Supabase storage public URL |
| aspect_ratio | text | `'9:16' \| '1:1' \| '16:9'` |
| created_at | timestamptz | |

### `subscriptions`, `usage_monthly`, `user_roles`
Already exist. Python backend reads via RPCs:
- `get_user_quota(_user_id uuid)` → returns `{ plan, status, used, monthly_limit, period_month }`
- `increment_video_usage(_user_id uuid)` → returns `{ allowed, used, monthly_limit }`
- `has_role(_user_id uuid, _role app_role)` → bool

**RLS is enabled.** Use the user's JWT for normal reads. Use service_role key ONLY for:
- Updating `videos.status / stage / progress / log_lines` from the pipeline worker
- Inserting `clips` from the pipeline worker
- Webhook handlers (Paddle)

### VideoStage enum (string)
```python
VideoStage = Literal[
  "queued", "downloading", "transcribing",
  "analyzing", "rendering", "uploading", "done", "error"
]
```

---

## 6. Environment Variables

Set these in Railway dashboard (and `.env` locally):

```bash
# Supabase
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=eyJ...           # publishable
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # secret — server-only
SUPABASE_JWT_SECRET=...            # to verify user JWTs

# Modal endpoints (from `modal deploy`)
MODAL_YT_URL=https://<workspace>--autocliper-yt-web.modal.run
MODAL_WHISPER_URL=https://<workspace>--autocliper-whisper-web.modal.run
MODAL_RENDER_URL=https://<workspace>--autocliper-render-web.modal.run
MODAL_AUTH_TOKEN=<shared bearer token>

# Lovable AI Gateway (for clip ranking)
LOVABLE_API_KEY=...

# Internal pipeline signing (so only Railway can trigger /pipeline/run)
INTERNAL_PIPELINE_SECRET=<random 32-byte hex>

# Paddle
PADDLE_WEBHOOK_SECRET=...

# App
FRONTEND_ORIGIN=https://autocliper.com
PORT=8080
```

---

## 7. HTTP API Contract (what frontend calls)

The React frontend currently calls TanStack `createServerFn`. After porting, frontend will call the FastAPI backend over HTTPS. Keep these endpoints **exactly** so frontend changes are minimal.

### `POST /api/videos`
Create a new video job.

**Auth:** Bearer Supabase JWT
**Body:**
```json
{
  "title": "string",
  "source_url": "https://youtube.com/... | null",
  "source_type": "youtube | upload",
  "config": {
    "aspect_ratio": "9:16",
    "subtitle_style": "bold_yellow",
    "face_tracking": false,
    "clip_count": 5
  }
}
```
**Response 201:**
```json
{ "video_id": "uuid" }
```
**Logic:**
1. Verify JWT → `user_id`.
2. Call `increment_video_usage(user_id)`. If `allowed=false`, return 402.
3. Insert `videos` row with `status='queued'`.
4. Fire-and-forget call to internal `POST /api/internal/pipeline/run` with the video_id and `X-Internal-Secret` header.
5. Return `video_id`.

### `GET /api/videos/{video_id}`
Returns video + its clips. RLS scopes to current user.

### `GET /api/quota`
Returns `Quota` dict (see section 5).

### `POST /api/internal/pipeline/run`
**Auth:** `X-Internal-Secret: <INTERNAL_PIPELINE_SECRET>` (NOT user JWT)
**Body:** `{ "video_id": "uuid" }`
**Response:** 202 immediately, runs pipeline async.

### `POST /api/public/paddle-webhook`
Verify HMAC, update `subscriptions` table. No auth.

---

## 8. Pipeline Flow (the heart of the app)

File: `app/tasks/pipeline.py`. This is what Antigravity needs to build most carefully.

```python
async def run_pipeline(video_id: str):
    """
    Orchestrates download → transcribe → analyze → render → upload.
    Updates videos.{status, stage, progress, log_lines} after each step.
    Inserts clips rows as they're rendered.
    """
    sb = service_role_client()
    video = sb.table("videos").select("*").eq("id", video_id).single().execute().data

    try:
        await _log(sb, video_id, "🚀 Starting pipeline")

        # 1. DOWNLOAD (Modal)
        await _set_stage(sb, video_id, "downloading", 5)
        if video["source_type"] == "youtube":
            meta = await modal_yt.download(video["source_url"])
            source_mp4_url = meta["stream_url"]  # signed URL from Modal
            duration_sec = meta["duration_sec"]
        else:
            # upload flow: source is already in Supabase storage uploads/<user_id>/<video_id>.mp4
            source_mp4_url = sb.storage.from_("uploads").create_signed_url(...)["signedURL"]
            duration_sec = await probe_duration(source_mp4_url)

        # 2. TRANSCRIBE (Modal Whisper)
        await _set_stage(sb, video_id, "transcribing", 25)
        transcript = await modal_whisper.transcribe(source_mp4_url)
        # transcript = [{ "start": 1.2, "end": 3.4, "text": "..." }, ...]

        # 3. ANALYZE (Lovable AI Gateway → Gemini)
        await _set_stage(sb, video_id, "analyzing", 50)
        clip_count = video["config"].get("clip_count", 5)
        suggestions = await ai_gateway.pick_viral_clips(
            title=video["title"],
            duration_sec=duration_sec,
            transcript=transcript,
            count=clip_count,
        )
        # suggestions = [{ title, hook, hashtags, start_time, end_time, score }, ...]

        # 4. RENDER each clip on Modal (parallel)
        await _set_stage(sb, video_id, "rendering", 60)
        async def render_one(idx, sug):
            clip_bytes = await modal_render.render_clip(
                source_url=source_mp4_url,
                start=sug["start_time"],
                end=sug["end_time"],
                aspect_ratio=video["config"]["aspect_ratio"],
                subtitle_style=video["config"]["subtitle_style"],
                transcript_window=_slice_transcript(transcript, sug["start_time"], sug["end_time"]),
            )
            # 5. UPLOAD
            path = f"{video['user_id']}/{video_id}/clip_{idx}.mp4"
            sb.storage.from_("clips").upload(path, clip_bytes, {"content-type": "video/mp4", "upsert": "true"})
            public_url = sb.storage.from_("clips").get_public_url(path)
            sb.table("clips").insert({
                "video_id": video_id,
                "title": sug["title"],
                "hook": sug["hook"],
                "hashtags": sug["hashtags"],
                "score": sug["score"],
                "start_time": sug["start_time"],
                "end_time": sug["end_time"],
                "video_url": public_url,
                "aspect_ratio": video["config"]["aspect_ratio"],
            }).execute()
            await _log(sb, video_id, f"✅ Clip {idx+1}/{len(suggestions)} rendered")

        await asyncio.gather(*[render_one(i, s) for i, s in enumerate(suggestions)])

        # 6. DONE
        sb.table("videos").update({
            "status": "done", "stage": "done", "progress": 100
        }).eq("id", video_id).execute()
        await _log(sb, video_id, "🎉 All clips ready")

    except Exception as e:
        sb.table("videos").update({
            "status": "error", "stage": "error",
            "error_message": str(e)[:500]
        }).eq("id", video_id).execute()
        await _log(sb, video_id, f"❌ Error: {e}")
        raise
```

Helpers:
```python
async def _set_stage(sb, vid, stage, progress):
    sb.table("videos").update({"stage": stage, "progress": progress, "status": "processing"}).eq("id", vid).execute()

async def _log(sb, vid, line):
    sb.rpc("append_video_log", {"_video_id": vid, "_line": line}).execute()
    # OR fetch log_lines, append, update — but RPC is atomic
```

You'll need to create a Postgres function `append_video_log(_video_id uuid, _line text)` in a migration.

---

## 9. Modal Apps (Python — deploy with `modal deploy`)

### 9.1 `modal_apps/yt_download.py`
**Already exists** — copy from `modal/yt_download.py` in current repo. Endpoints:
- `GET /info?url=<yt_url>` → `{ stream_path, duration_sec, title, thumbnail }`
- `GET /file/{vid}?expires=&sig=` → mp4 stream

### 9.2 `modal_apps/whisper.py` (NEW)
```python
import modal

app = modal.App("autocliper-whisper")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install("faster-whisper==1.0.3", "fastapi[standard]==0.115.0")
)

@app.function(image=image, gpu="T4", timeout=900, secrets=[modal.Secret.from_name("yt-auth")])
@modal.asgi_app()
def web():
    from fastapi import FastAPI, Header, HTTPException
    from pydantic import BaseModel
    import os, httpx, tempfile
    from faster_whisper import WhisperModel

    api = FastAPI()
    model = WhisperModel("small", device="cuda", compute_type="float16")

    class Req(BaseModel):
        source_url: str

    @api.post("/transcribe")
    async def transcribe(req: Req, authorization: str | None = Header(None)):
        if authorization != f"Bearer {os.environ['MODAL_AUTH_TOKEN']}":
            raise HTTPException(401)
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            async with httpx.AsyncClient() as c:
                r = await c.get(req.source_url, follow_redirects=True, timeout=300)
                f.write(r.content)
            segments, _ = model.transcribe(f.name, word_timestamps=False)
            return {"segments": [{"start": s.start, "end": s.end, "text": s.text} for s in segments]}
    return api
```

### 9.3 `modal_apps/render.py` (NEW)
```python
import modal

app = modal.App("autocliper-render")
image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg", "fonts-dejavu-core")
    .pip_install("fastapi[standard]==0.115.0", "httpx==0.27.2")
)

@app.function(image=image, cpu=4, memory=4096, timeout=600, secrets=[modal.Secret.from_name("yt-auth")])
@modal.asgi_app()
def web():
    from fastapi import FastAPI, Header, HTTPException
    from fastapi.responses import Response
    from pydantic import BaseModel
    import os, httpx, tempfile, subprocess, pathlib

    api = FastAPI()

    class Segment(BaseModel):
        start: float
        end: float
        text: str

    class Req(BaseModel):
        source_url: str
        start: float
        end: float
        aspect_ratio: str = "9:16"
        subtitle_style: str = "bold_yellow"
        transcript: list[Segment] = []

    @api.post("/render")
    async def render(req: Req, authorization: str | None = Header(None)):
        if authorization != f"Bearer {os.environ['MODAL_AUTH_TOKEN']}":
            raise HTTPException(401)

        with tempfile.TemporaryDirectory() as td:
            src = pathlib.Path(td) / "src.mp4"
            out = pathlib.Path(td) / "out.mp4"
            srt = pathlib.Path(td) / "subs.srt"

            # 1. Download source
            async with httpx.AsyncClient() as c:
                async with c.stream("GET", req.source_url, follow_redirects=True, timeout=300) as r:
                    with src.open("wb") as f:
                        async for chunk in r.aiter_bytes(1024*1024):
                            f.write(chunk)

            # 2. Build SRT for the clip window (rebased to clip-local time)
            srt.write_text(_segments_to_srt(req.transcript, req.start))

            # 3. ffmpeg: trim → crop 9:16 → burn subs
            vf = _build_vf(req.aspect_ratio, req.subtitle_style, str(srt))
            cmd = [
                "ffmpeg", "-y", "-ss", str(req.start), "-to", str(req.end),
                "-i", str(src), "-vf", vf,
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                str(out),
            ]
            r = subprocess.run(cmd, capture_output=True)
            if r.returncode != 0:
                raise HTTPException(500, detail=r.stderr.decode()[-500:])
            return Response(content=out.read_bytes(), media_type="video/mp4")

    def _segments_to_srt(segs, base):
        # standard SRT, timestamps = seg.start - base
        ...

    def _build_vf(ar, style, srt_path):
        # ar="9:16": crop=ih*9/16:ih,scale=1080:1920
        # subtitles=...:force_style='FontName=DejaVu Sans,Bold=1,PrimaryColour=&H0000FFFF'
        ...

    return api
```

---

## 10. Lovable AI Gateway (clip ranking)

Use existing logic from `src/lib/ai.functions.ts` — port to Python:

```python
# app/services/ai_gateway.py
import os, httpx, json

async def pick_viral_clips(title, duration_sec, transcript, count):
    transcript_text = "\n".join(f"[{int(s['start'])}s] {s['text']}" for s in transcript)
    system = f"You are a viral short-form video editor. Pick {count} non-overlapping 20-25s clips from a video. Return STRICT JSON."
    user = f'''Title: "{title}"
Duration: {int(duration_sec)}s
Transcript:
{transcript_text}

Return: {{ "clips": [ {{ "title": str, "hook": str, "hashtags": [str], "start_time": int, "end_time": int, "score": int }} ] }}
Rules: 20<=end-start<=25, non-overlapping, sorted by score desc.'''

    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(
            "https://ai.gateway.lovable.dev/v1/chat/completions",
            headers={"Authorization": f"Bearer {os.environ['LOVABLE_API_KEY']}"},
            json={
                "model": "google/gemini-2.5-flash",
                "messages": [{"role":"system","content":system},{"role":"user","content":user}],
                "response_format": {"type":"json_object"},
            },
        )
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
        return json.loads(content)["clips"]
```

---

## 11. Auth (Supabase JWT verification)

```python
# app/auth.py
import os, jwt
from fastapi import Header, HTTPException, Depends

def get_current_user(authorization: str | None = Header(None)) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = jwt.decode(
            token,
            os.environ["SUPABASE_JWT_SECRET"],
            algorithms=["HS256"],
            audience="authenticated",
        )
        return payload["sub"]  # user_id
    except jwt.PyJWTError as e:
        raise HTTPException(401, f"Invalid token: {e}")

# Usage: def endpoint(user_id: str = Depends(get_current_user)): ...
```

---

## 12. Deployment to Railway

### `Procfile`
```
web: gunicorn -k uvicorn.workers.UvicornWorker app.main:app --bind 0.0.0.0:$PORT --workers 1 --timeout 120
```

(Use 1 worker on $5 plan — 512MB RAM limit.)

### `railway.toml`
```toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "gunicorn -k uvicorn.workers.UvicornWorker app.main:app --bind 0.0.0.0:$PORT --workers 1 --timeout 120"
healthcheckPath = "/health"
healthcheckTimeout = 30
restartPolicyType = "ON_FAILURE"
```

Steps:
1. Push `backend/` folder to GitHub.
2. Railway → New Project → Deploy from GitHub repo.
3. Set Root Directory = `backend/`.
4. Add all env vars from section 6.
5. Deploy. Note the public URL → set as `VITE_BACKEND_URL` in frontend.

---

## 13. CORS

```python
# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import os

app = FastAPI(title="AutoCliper API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health(): return {"ok": True}
```

---

## 14. Implementation Order (DO IN THIS ORDER)

1. `app/main.py` + `/health` endpoint → deploy to Railway → confirm live.
2. `app/auth.py` + `GET /api/quota` → confirm JWT verification works.
3. Deploy `modal_apps/whisper.py` + `modal_apps/render.py` → save URLs to env.
4. `app/services/modal_yt.py`, `modal_whisper.py`, `modal_render.py` (HTTP clients).
5. `app/services/ai_gateway.py`.
6. `app/tasks/pipeline.py` (the orchestrator).
7. `POST /api/videos` + `POST /api/internal/pipeline/run`.
8. `GET /api/videos/{id}` + Paddle webhook.
9. Frontend: replace `createServerFn` calls with `fetch(VITE_BACKEND_URL + "/api/...")`.

---

## 15. Frontend Changes (minimal)

Once backend is live, update these files in the React app to call FastAPI instead of TanStack server fns:

- `src/lib/billing.functions.ts` → swap `createServerFn` body to `fetch`
- `src/lib/ai.functions.ts` → delete (logic moved to backend)
- `src/lib/real-pipeline.ts` → replace ffmpeg.wasm pipeline with single POST to `/api/videos`
- Add `VITE_BACKEND_URL` to `.env`
- Add Supabase Realtime subscription on `videos` row for live progress

---

## 16. Don'ts (critical)

- ❌ Don't run yt-dlp on Railway. EVER.
- ❌ Don't run ffmpeg on Railway. EVER.
- ❌ Don't load Whisper model on Railway. EVER.
- ❌ Don't expose `SUPABASE_SERVICE_ROLE_KEY` in any HTTP response or log.
- ❌ Don't call `/api/internal/pipeline/run` without `X-Internal-Secret`.
- ❌ Don't skip JWT verification on user-facing endpoints.
- ❌ Don't use Supabase RLS-bypass (service role) for user-initiated reads — use the user's JWT so RLS applies.

---

## 17. Local Dev

```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env  # fill in values
uvicorn app.main:app --reload --port 8080
```

Modal apps:
```bash
modal token new
modal deploy modal_apps/yt_download.py
modal deploy modal_apps/whisper.py
modal deploy modal_apps/render.py
```

---

## 18. Reference Files in this Repo (read these for business logic)

| TypeScript file | What to port from it |
|-----------------|---------------------|
| `src/lib/ai.functions.ts` | Prompt + JSON schema for clip ranking |
| `src/lib/billing.functions.ts` | Quota logic — wraps `get_user_quota` & `increment_video_usage` RPCs |
| `src/lib/real-pipeline.ts` | End-to-end flow (currently runs in browser with ffmpeg.wasm — replicate server-side) |
| `src/lib/autocliper-types.ts` | TypeScript types — mirror as Pydantic models |
| `src/lib/paddle.ts` | Paddle webhook signature verification |
| `src/routes/api/public/paddle-webhook.ts` | Webhook payload handling |
| `modal/yt_download.py` | Already Python — just move into `backend/modal_apps/` |
| `supabase/migrations/*.sql` | DB schema — DO NOT change column names |

---

**End of spec.** An AI agent reading this file has everything needed to produce a working Python backend without further prompting. Build incrementally per section 14, test each step, and the full pipeline should be live in 1–2 days.
