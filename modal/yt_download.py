"""
Modal app: YouTube -> muxed MP4 resolver.

Deploy:
    pip install modal
    modal token new           # one-time
    modal deploy modal/yt_download.py

After deploy, Modal prints a public URL like:
    https://<workspace>--autocliper-yt-resolve.modal.run

Save it as MODAL_YT_URL in Lovable secrets, and set MODAL_AUTH_TOKEN to any
random string you also configure here as a Modal secret named "yt-auth".

Create the Modal secret once:
    modal secret create yt-auth MODAL_AUTH_TOKEN=<same-token-you-use-in-lovable>

Endpoint:
    GET  /?url=<youtube-url>     -> 302 redirect to a temporary signed mp4
    GET  /info?url=<youtube-url> -> JSON metadata
Both require header:  Authorization: Bearer <MODAL_AUTH_TOKEN>

The resolver uses yt-dlp + ffmpeg to produce a single muxed mp4 (<=720p),
uploads it to Modal's CDN-backed Volume, and serves it via a signed URL.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import subprocess
import time
import uuid
from pathlib import Path

import modal

APP_NAME = "autocliper-yt"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    # Use yt-dlp nightly — YouTube changes extractors weekly, stable releases lag.
    .pip_install(
        "yt-dlp[default] @ https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp.tar.gz",
        "fastapi[standard]==0.115.0",
        force_build=False,
    )
)


volume = modal.Volume.from_name("yt-cache", create_if_missing=True)
app = modal.App(APP_NAME)

CACHE_DIR = "/cache"
TTL_SECONDS = 30 * 60  # 30 min


def _sign(video_id: str, expires: int, secret: str) -> str:
    msg = f"{video_id}:{expires}".encode()
    return hmac.new(secret.encode(), msg, hashlib.sha256).hexdigest()


def _check_sig(video_id: str, expires: int, sig: str, secret: str) -> bool:
    if expires < int(time.time()):
        return False
    expected = _sign(video_id, expires, secret)
    return hmac.compare_digest(expected, sig)


def _require_bearer(authorization: str | None) -> None:
    from fastapi import HTTPException

    expected = os.environ.get("MODAL_AUTH_TOKEN", "")
    if not expected:
        raise HTTPException(status_code=500, detail="server missing MODAL_AUTH_TOKEN")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="missing bearer token")
    if not hmac.compare_digest(authorization.removeprefix("Bearer ").strip(), expected):
        raise HTTPException(status_code=401, detail="bad token")


@app.function(
    image=image,
    volumes={CACHE_DIR: volume},
    secrets=[modal.Secret.from_name("yt-auth")],
    timeout=600,
    cpu=2,
    memory=2048,
)
def download(video_id: str) -> dict:
    """Download + mux a YouTube video into cache. Idempotent per video_id."""
    out_dir = Path(CACHE_DIR) / video_id
    out_dir.mkdir(parents=True, exist_ok=True)
    final = out_dir / "video.mp4"
    meta_file = out_dir / "meta.json"

    if final.exists() and meta_file.exists():
        import json as _json

        return _json.loads(meta_file.read_text())

    import yt_dlp  # type: ignore

    tmp_template = str(out_dir / "raw.%(ext)s")

    # Optional cookies.txt mounted via Modal secret YT_COOKIES_TXT (Netscape format)
    cookies_path = None
    cookies_txt = os.environ.get("YT_COOKIES_TXT")
    if cookies_txt:
        cookies_path = str(out_dir / "cookies.txt")
        Path(cookies_path).write_text(cookies_txt)

    ydl_opts = {
        "format": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]",
        "outtmpl": tmp_template,
        "merge_output_format": "mp4",
        "quiet": True,
        "noprogress": True,
        "no_warnings": True,
        "concurrent_fragment_downloads": 4,
        "retries": 5,
        "fragment_retries": 5,
        "extractor_retries": 3,
        # Bot-bypass: tv_embedded + web_safari work best without cookies right now.
        # mweb is currently broken for many videos (returns 500 from googlevideo).
        "extractor_args": {
            "youtube": {
                "player_client": ["tv_embedded", "web_safari", "ios", "android"],
                "player_skip": ["configs", "webpage"],
            }
        },

        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 "
                "Mobile/15E148 Safari/604.1"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        },
        "geo_bypass": True,
        "nocheckcertificate": True,
        "postprocessors": [
            {"key": "FFmpegVideoConvertor", "preferedformat": "mp4"},
        ],
    }
    if cookies_path:
        ydl_opts["cookiefile"] = cookies_path

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(
            f"https://www.youtube.com/watch?v={video_id}", download=True
        )

    # yt-dlp may write raw.mp4 or raw.webm.mp4; find it.
    candidates = sorted(out_dir.glob("raw*"), key=lambda p: p.stat().st_size, reverse=True)
    if not candidates:
        raise RuntimeError("yt-dlp produced no output")
    src = candidates[0]
    if src.suffix.lower() != ".mp4":
        subprocess.run(
            [
                "ffmpeg", "-y", "-i", str(src),
                "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
                "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart",
                str(final),
            ],
            check=True, capture_output=True,
        )
        src.unlink(missing_ok=True)
    else:
        src.rename(final)

    # Re-mux faststart so the browser can start playback before full download.
    fast = out_dir / "video.fast.mp4"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(final), "-c", "copy", "-movflags", "+faststart", str(fast)],
        check=True, capture_output=True,
    )
    fast.replace(final)

    meta = {
        "video_id": video_id,
        "title": info.get("title") or "YouTube video",
        "duration_sec": int(info.get("duration") or 0),
        "thumbnail": info.get("thumbnail"),
        "size_bytes": final.stat().st_size,
        "mime_type": "video/mp4",
    }
    import json as _json

    meta_file.write_text(_json.dumps(meta))
    volume.commit()
    return meta


@app.function(
    image=image,
    volumes={CACHE_DIR: volume},
    secrets=[modal.Secret.from_name("yt-auth")],
    # /info waits for the first download to finish so the app receives a real MP4.
    # 120s caused Modal platform 500s for slower YouTube downloads.
    timeout=900,
    min_containers=0,
)
@modal.concurrent(max_inputs=20)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, Header, HTTPException, Query
    from fastapi.responses import RedirectResponse, StreamingResponse, JSONResponse
    import re

    fastapi = FastAPI()

    def extract_id(raw: str) -> str | None:
        m = re.search(r"(?:v=|youtu\.be/|/shorts/|/embed/)([A-Za-z0-9_-]{11})", raw)
        if m:
            return m.group(1)
        if re.fullmatch(r"[A-Za-z0-9_-]{11}", raw):
            return raw
        return None

    def run_download(vid: str) -> dict:
        try:
            return download.remote(vid)
        except Exception as exc:
            detail = str(exc) or exc.__class__.__name__
            raise HTTPException(status_code=502, detail=f"yt-dlp failed: {detail}") from exc

    @fastapi.get("/info")
    def info(url: str = Query(...), authorization: str | None = Header(default=None)):
        _require_bearer(authorization)
        vid = extract_id(url)
        if not vid:
            raise HTTPException(status_code=400, detail="invalid youtube url")
        meta = run_download(vid)
        secret = os.environ["MODAL_AUTH_TOKEN"]
        expires = int(time.time()) + TTL_SECONDS
        sig = _sign(vid, expires, secret)
        return JSONResponse(
            {
                **meta,
                "stream_path": f"/file/{vid}?expires={expires}&sig={sig}",
            }
        )

    @fastapi.get("/")
    def resolve(url: str = Query(...), authorization: str | None = Header(default=None)):
        _require_bearer(authorization)
        vid = extract_id(url)
        if not vid:
            raise HTTPException(status_code=400, detail="invalid youtube url")
        run_download(vid)
        secret = os.environ["MODAL_AUTH_TOKEN"]
        expires = int(time.time()) + TTL_SECONDS
        sig = _sign(vid, expires, secret)
        return RedirectResponse(url=f"/file/{vid}?expires={expires}&sig={sig}", status_code=302)

    @fastapi.get("/file/{vid}")
    def serve(vid: str, expires: int, sig: str):
        secret = os.environ["MODAL_AUTH_TOKEN"]
        if not _check_sig(vid, expires, sig, secret):
            raise HTTPException(status_code=403, detail="bad or expired signature")
        path = Path(CACHE_DIR) / vid / "video.mp4"
        if not path.exists():
            volume.reload()
        if not path.exists():
            raise HTTPException(status_code=404, detail="not cached")

        def iterfile():
            with path.open("rb") as f:
                while chunk := f.read(1024 * 1024):
                    yield chunk

        return StreamingResponse(
            iterfile(),
            media_type="video/mp4",
            headers={
                "Content-Length": str(path.stat().st_size),
                "Cache-Control": "no-store",
                "Access-Control-Allow-Origin": "*",
            },
        )

    return fastapi
