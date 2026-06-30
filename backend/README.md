# AutoCliper Backend (Python)

Production-ready Python backend for AutoCliper (YouTube to viral shorts clipper). Built using **FastAPI + Modal + Supabase + Lovable AI Gateway**.

This backend replaces the original TanStack server functions. The orchestration layer runs on Railway, while heavy media processing workloads (video downloading, transcription, rendering) run entirely on serverless GPU/CPU containers via Modal.

---

## Repository Structure

```
backend/
├── app/
│   ├── main.py                 # FastAPI application and CORS setup
│   ├── config.py               # Settings manager (loads env variables)
│   ├── auth.py                 # Supabase JWT token verification
│   ├── supabase_client.py      # Supabase python-py clients (user + service_role)
│   ├── models/                 # Pydantic validation models
│   ├── routers/                # HTTP API route controllers
│   │   ├── videos.py           # User endpoints (POST /api/videos, GET /api/videos/{id})
│   │   ├── pipeline.py         # Internal orchestrator trigger
│   │   ├── billing.py          # Quota checking (GET /api/quota)
│   │   └── webhooks.py         # Paddle payment webhook
│   └── tasks/
│       └── pipeline.py         # Async pipeline orchestrator (downloads, transcribes, crops, uploads)
├── modal_apps/
│   ├── yt_download.py          # yt-dlp downloading and caching service
│   ├── whisper.py              # CUDA-accelerated Whisper transcription
│   └── render.py               # ffmpeg vertical video cropping and subtitle burn-in
├── requirements.txt            # Python dependencies
├── Procfile                    # Command for Railway runtime (Gunicorn + Uvicorn workers)
└── railway.toml                # Railway deployment configuration (Nixpacks build instructions)
```

---

## Local Development Setup

### 1. Create a Python Virtual Environment
Navigate to the `backend/` directory and initialize a virtual environment:
```bash
cd backend
python -m venv venv
# On Windows (PowerShell):
.\venv\Scripts\Activate.ps1
# On macOS/Linux:
source venv/bin/activate
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Setup Env Variables
Copy the template and fill in the values:
```bash
cp .env.example .env
```
Make sure you set your Supabase credentials, Lovable API key, and Modal endpoints (once deployed).

### 4. Run the Server Local
Start the FastAPI server:
```bash
uvicorn app.main:app --reload --port 8080
```
Visit `http://localhost:8080/health` to confirm the API is running.

---

## Modal Applications Deployment

Modal is used to execute resource-intensive tasks (downloading, audio transcribing, rendering) serverless-ly on GPU-enabled instances.

### 1. Initialize Modal CLI
Authenticate with your Modal account:
```bash
pip install modal
modal token new
```

### 2. Create Modal Secrets
Create a secret named `yt-auth` in your Modal dashboard or CLI containing `MODAL_AUTH_TOKEN` (the same bearer token you set in your `.env` file) and optional cookies (for YouTube bot bypass):
```bash
modal secret create yt-auth MODAL_AUTH_TOKEN="your-chosen-bearer-token"
```

### 3. Deploy the 3 Modal Apps
Deploy the three apps located in `backend/modal_apps/`:
```bash
modal deploy modal_apps/yt_download.py
modal deploy modal_apps/whisper.py
modal deploy modal_apps/render.py
```
Each deployment will output a public ASGI web endpoint URL (e.g. `https://<workspace>--autocliper-whisper-web.modal.run`). 
Copy these URLs and set them in your backend's `.env` (and Railway dashboard) under:
- `MODAL_YT_URL`
- `MODAL_WHISPER_URL`
- `MODAL_RENDER_URL`

---

## Railway Deployment ($5 Plan)

This backend runs on Railway's $5 plan (512MB RAM). No heavy rendering or download takes place on this instance.

### Step-by-step deploy instructions:
1. Commit all your changes and push the code (including the new `backend/` directory) to your GitHub repository.
2. Go to the [Railway Dashboard](https://railway.app) and create a **New Project**.
3. Choose **Deploy from GitHub repo** and select your repository.
4. Go to **Settings** of the service and change the **Root Directory** to `backend`.
5. Under **Variables**, add all keys defined in the Environment Variables section below.
6. Railway will automatically pick up the Nixpacks builder instructions from `railway.toml` and run the server using `Procfile`.
7. Once deployed, note the Railway public domain (e.g. `https://your-backend.up.railway.app`). Set this as `VITE_BACKEND_URL` in your frontend environment.

### Required Environment Variables to set in Railway:
| Name | Description |
|------|-------------|
| `SUPABASE_URL` | Your Supabase project URL (`https://<ref>.supabase.co`) |
| `SUPABASE_ANON_KEY` | Your Supabase publishable anonymous key |
| `SUPABASE_SERVICE_ROLE_KEY` | Your Supabase service role key (bypass RLS for workers) |
| `SUPABASE_JWT_SECRET` | Your Supabase project JWT secret (to verify user authentications) |
| `MODAL_YT_URL` | Deployed URL of `yt_download` Modal app |
| `MODAL_WHISPER_URL` | Deployed URL of `whisper` Modal app |
| `MODAL_RENDER_URL` | Deployed URL of `render` Modal app |
| `MODAL_AUTH_TOKEN` | Bearer token configured in the Modal secret `yt-auth` |
| `LOVABLE_API_KEY` | Lovable API gateway key to call Gemini |
| `INTERNAL_PIPELINE_SECRET` | A secure, random 32-byte hex string to authenticate internal pipeline triggers |
| `PADDLE_WEBHOOK_SECRET` | Secret key provided by Paddle to verify webhook events signature |
| `PADDLE_PRICE_STARTER` | Paddle product price ID for the Starter tier |
| `PADDLE_PRICE_PRO` | Paddle product price ID for the Pro tier |
| `FRONTEND_ORIGIN` | Allowed CORS frontend origin (e.g., your production Webapp URL) |
| `PORT` | Set automatically by Railway (defaults to `8080` locally) |
