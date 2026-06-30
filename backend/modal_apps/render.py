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
    from fastapi.responses import Response, JSONResponse
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
        subtitle_style: str = "tiktok"
        transcript: list[Segment] = []

    class ProbeReq(BaseModel):
        source_url: str

    def format_timestamp(seconds: float) -> str:
        if seconds < 0:
            seconds = 0.0
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        millis = int(round((seconds - int(seconds)) * 1000))
        if millis >= 1000:
            millis = 999
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

    def _segments_to_srt(segs: list[Segment], base: float) -> str:
        lines = []
        for idx, seg in enumerate(segs):
            local_start = max(0.0, seg.start - base)
            local_end = max(0.0, seg.end - base)
            lines.append(str(idx + 1))
            lines.append(f"{format_timestamp(local_start)} --> {format_timestamp(local_end)}")
            lines.append(seg.text.strip())
            lines.append("")
        return "\n".join(lines)

    def _build_vf(ar: str, style: str, srt_path: str) -> str:
        filters = []
        
        # Crop & scale
        if ar == "9:16":
            filters.append("crop=ih*9/16:ih")
            filters.append("scale=1080:1920")
        elif ar == "1:1":
            filters.append("crop=ih:ih")
            filters.append("scale=1080:1080")
        elif ar == "16:9":
            filters.append("scale=1920:1080")

        # Subtitles configuration
        # Escape colons for ffmpeg path on Linux/Unix
        escaped_srt = srt_path.replace(":", "\\:").replace("'", "'\\\\''")
        
        # Style presets using ASS format overrides
        if style == "tiktok":
            # Yellow text, bold, black outline, lower-third alignment
            style_str = "FontName=DejaVu Sans,FontSize=20,Bold=1,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=100"
        elif style == "podcast":
            # White text, bold, pink/magenta outline, slightly higher margin
            style_str = "FontName=DejaVu Sans,FontSize=22,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00FF00FF,BorderStyle=1,Outline=1.5,Shadow=1,Alignment=2,MarginV=150"
        else:  # minimalist / default
            # White text, regular font, no border, standard shadow
            style_str = "FontName=DejaVu Sans,FontSize=18,Bold=0,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=0,Shadow=1,Alignment=2,MarginV=100"
            
        filters.append(f"subtitles='{escaped_srt}':force_style='{style_str}'")
        return ",".join(filters)

    @api.post("/render")
    async def render(req: Req, authorization: str | None = Header(None)):
        if authorization != f"Bearer {os.environ['MODAL_AUTH_TOKEN']}":
            raise HTTPException(401, detail="Unauthorized")

        with tempfile.TemporaryDirectory() as td:
            src = pathlib.Path(td) / "src.mp4"
            out = pathlib.Path(td) / "out.mp4"
            srt = pathlib.Path(td) / "subs.srt"

            # 1. Download source
            try:
                async with httpx.AsyncClient() as c:
                    async with c.stream("GET", req.source_url, follow_redirects=True, timeout=300) as r:
                        r.raise_for_status()
                        with src.open("wb") as f:
                            async for chunk in r.aiter_bytes(1024*1024):
                                f.write(chunk)
            except Exception as e:
                raise HTTPException(502, detail=f"Failed to fetch source video: {e}")

            # 2. Build SRT for the clip window
            srt.write_text(_segments_to_srt(req.transcript, req.start), encoding="utf-8")

            # 3. ffmpeg: trim -> crop -> burn subs
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
                err_detail = r.stderr.decode(errors="ignore")[-500:]
                raise HTTPException(500, detail=f"ffmpeg failed: {err_detail}")
                
            return Response(content=out.read_bytes(), media_type="video/mp4")

    @api.post("/probe")
    async def probe(req: ProbeReq, authorization: str | None = Header(None)):
        if authorization != f"Bearer {os.environ['MODAL_AUTH_TOKEN']}":
            raise HTTPException(401, detail="Unauthorized")
            
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            req.source_url
        ]
        
        r = subprocess.run(cmd, capture_output=True, text=True)
        if r.returncode != 0:
            raise HTTPException(500, detail=f"ffprobe failed: {r.stderr}")
            
        try:
            duration = float(r.stdout.strip())
            return {"duration_sec": duration}
        except ValueError:
            raise HTTPException(500, detail=f"Invalid duration output from ffprobe: {r.stdout}")

    return api
