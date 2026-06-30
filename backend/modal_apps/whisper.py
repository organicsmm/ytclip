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
    # Cache model in container memory across warm requests
    model = WhisperModel("small", device="cuda", compute_type="float16")

    class Req(BaseModel):
        source_url: str

    @api.post("/transcribe")
    async def transcribe(req: Req, authorization: str | None = Header(None)):
        if authorization != f"Bearer {os.environ['MODAL_AUTH_TOKEN']}":
            raise HTTPException(401, detail="Unauthorized")
            
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as f:
            temp_name = f.name
            try:
                # Download file to local temp directory inside container
                async with httpx.AsyncClient() as c:
                    # Larger files need a longer timeout
                    r = await c.get(req.source_url, follow_redirects=True, timeout=600)
                    r.raise_for_status()
                    f.write(r.content)
                
                # Transcribe
                segments, _ = model.transcribe(temp_name, word_timestamps=False)
                return {"segments": [{"start": s.start, "end": s.end, "text": s.text} for s in segments]}
            finally:
                # Ensure local file is removed
                try:
                    os.unlink(temp_name)
                except Exception:
                    pass

    return api
