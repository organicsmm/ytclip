## Skate AI — Build Plan

A dark, glowing video shorts clipper. Paste a YouTube URL or upload a video → transcribe → AI-rank viral segments → render vertical clips with burned-in subtitles → download.

### Scope for v1

**Frontend (TanStack Start)**
- Dark theme tokens in `src/styles.css`: slate/navy `#090D16` bg, indigo `#6366F1` accent, glow shadows, glass surfaces. Outfit (headings) + Inter (UI) via `<link>` in `__root.tsx`.
- Routes:
  - `/` — Dashboard: tabs (YouTube / Upload), aspect ratio + subtitle style dropdowns, face-tracking/center-crop switch, "Generate Viral Clips" CTA.
  - `/` also hosts the live `skate-pipeline.log` terminal card and results grid (per spec).
  - `/history` — past runs from DB; clicking a run loads its clips.
- Components: `SubmissionPanel`, `PipelineTerminal`, `ClipsGrid`, `ClipCard` (HTML5 9:16/1:1 player, score badge, hook, hashtags, download), `HistoryList`, `StatusBadge` in header.
- Realtime progress via Supabase Realtime on the `videos` row (`status`, `progress`, `stage`, `log_lines[]`).

**Backend (Lovable Cloud)**
- Tables (with GRANTs + RLS):
  - `videos`: id, user_id, title, source_url, source_type, status, stage, progress, log_lines (text[]), config (jsonb), created_at
  - `clips`: id, video_id, title, start_time, end_time, score, hook, video_url, hashtags (text[]), aspect_ratio, created_at
- Storage bucket `clips/` (public read) for rendered MP4s; `uploads/` (private) for user-uploaded sources.
- Server functions (TanStack `createServerFn`):
  - `createVideoJob` — insert row, kick off pipeline route.
  - `listVideos`, `getVideoWithClips`.
- Pipeline server route `POST /api/public/pipeline/run` (signed with internal secret), runs async:
  1. Download (YouTube) / fetch upload from storage.
  2. Transcribe with **Lovable AI Gateway** (`google/gemini-3-flash-preview` for ranking; transcription via gateway-supported model).
  3. Chunk transcript, ask LLM for top N segments → structured JSON (start, end, hook, score, hashtags).
  4. Render: call FFmpeg.

### Honest constraint: FFmpeg + YouTube download

The Cloudflare Worker runtime that hosts server functions **cannot run FFmpeg, yt-dlp, or any native binary** (no child_process, no native modules). For real video rendering and YT downloads in v1, we have two viable paths — I'll implement **Option A** unless you say otherwise:

- **Option A (recommended): External worker via Replicate/Modal/Render**
  - Use Replicate models for: YouTube download + transcription (whisper) + FFmpeg slice/crop/subtitle burn. The Worker orchestrates; Replicate does the heavy lifting; outputs land in Supabase Storage.
  - Requires `REPLICATE_API_TOKEN` secret. I'll prompt for it after the UI is wired.
- **Option B: Mock rendering**
  - Skip download/render; show transcript-driven clip metadata over a placeholder video. Useful for demoing UI only.

### Out of scope for v1
- AI face tracking (Replicate has models but adds cost/complexity — center-crop only in v1; toggle stays in UI but disabled with "coming soon").
- Auth — single-user demo mode using a synthetic user_id stored in localStorage; can add real auth later.

### Deliverables this turn
1. Enable Lovable Cloud.
2. Design tokens + fonts + header.
3. DB migration (videos, clips, GRANTs, RLS, realtime).
4. Storage buckets.
5. Dashboard UI + pipeline terminal + clips grid + history (with mocked pipeline that writes real DB rows and streams fake log lines so the whole flow is visible end-to-end).
6. Stub the pipeline server route with TODOs where Replicate calls go, behind a feature flag.

After you approve, I'll execute. Confirm:
- **Option A (Replicate) or Option B (mock-only) for v1 rendering?**
- OK to defer real auth and run single-user demo mode?
