# server.py (FULL - with /save)
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import cv2
import numpy as np
import os
import re

import main  # your main.py

app = FastAPI()

# ✅ allow your frontend to call backend (important!)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # for dev only; later put your real domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Crop(BaseModel):
    enabled: bool = False
    x: float = 0.0
    y: float = 0.0
    w: float = 1.0
    h: float = 1.0

class Params(BaseModel):
    brightness: int = 0
    sharpness: int = 0
    denoise: int = 0
    red: int = 0
    green: int = 0
    blue: int = 0
    mono: bool = False
    crop: Crop = Crop()

class ProcessRequest(BaseModel):
    image: str          # dataURL: "data:image/png;base64,...."
    params: Params

class SaveRequest(BaseModel):
    image: str          # dataURL
    path: str | None = None  # e.g. "download/image_01.png"

DATAURL_RE = re.compile(r"^data:image\/[a-zA-Z0-9.+-]+;base64,")

def decode_image(data_url: str):
    if "," not in data_url:
        raise ValueError("Invalid dataURL")
    header, b64 = data_url.split(",", 1)
    img_bytes = base64.b64decode(b64)
    arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode image")
    return img

def encode_image(img):
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("Failed to encode image.")
    return "data:image/png;base64," + base64.b64encode(buf).decode("utf-8")

def sanitize_path(p: str) -> str:
    # default
    p = (p or "").strip()
    if not p:
        p = "download/image_01.png"

    # normalize
    norm = os.path.normpath(p).replace("\\", "/")

    # block absolute + parent traversal
    if os.path.isabs(norm) or norm.startswith("../") or norm.startswith(".."):
        raise HTTPException(status_code=400, detail="Invalid path")

    # ensure file extension
    root, ext = os.path.splitext(norm)
    if ext.lower() not in [".png", ".jpg", ".jpeg", ".webp"]:
        # default to png if user forgot extension
        norm = norm + ".png"

    return norm

@app.post("/process")
def process(req: ProcessRequest):
    try:
        img = decode_image(req.image)
        out = main.process_image(img, req.params.model_dump())
        return {"image": encode_image(out)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/remove-bg")
def remove_bg(req: ProcessRequest):
    try:
        img = decode_image(req.image)
        out = main.remove_background(img)
        return {"image": encode_image(out)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/crop")
def crop_commit(req: ProcessRequest):
    try:
        img = decode_image(req.image)
        p = req.params.model_dump()
        out = main.apply_crop(img, p.get("crop", {}))
        return {"image": encode_image(out)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/save")
def save_image(req: SaveRequest):
    """
    Expects:
      { "image": "data:image/png;base64,...", "path": "download/image_01.png" }
    Saves relative to your backend working directory.
    """
    if not req.image:
        raise HTTPException(status_code=400, detail="Missing image")

    path = sanitize_path(req.path or "")

    # strip data url header
    b64 = DATAURL_RE.sub("", req.image)

    try:
        raw = base64.b64decode(b64)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid base64 image")

    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)

    try:
        with open(path, "wb") as f:
            f.write(raw)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write file: {e}")

    return {"ok": True, "saved_to": path}
