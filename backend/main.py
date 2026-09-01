import os
import base64
from io import BytesIO
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
from schemas.agent import AgentRequest, AgentResponse, PlanRequest, PlanResponse
from agent.controller import analyze_task
from agent.plan_controller import build_plan

load_dotenv()

app = FastAPI(
    title="Privacy-Preserving AI Agent",
    description="Backend agent API for sanitized screen context"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

ocr_engine = None


def get_ocr():
    global ocr_engine
    if ocr_engine is None:
        from rapidocr_onnxruntime import RapidOCR
        ocr_engine = RapidOCR()
    return ocr_engine


class OCRRegion(BaseModel):
    text: str
    confidence: float
    x: float
    y: float
    width: float
    height: float


class OCRRequest(BaseModel):
    image: str


class OCRResponse(BaseModel):
    success: bool
    regions: List[OCRRegion]
    error: Optional[str] = None


@app.get("/")
def root():
    return {"status": "ok", "message": "Privacy Agent Backend"}


@app.get("/health")
def health():
    api_key = os.getenv("LLM_API_KEY", "")
    return {
        "status": "healthy",
        "llm_configured": bool(api_key),
        "mode": "mock" if not api_key else "live"
    }


@app.post("/ocr", response_model=OCRResponse)
def run_ocr(request: OCRRequest):
    try:
        image_data = request.image
        if "," in image_data:
            image_data = image_data.split(",", 1)[1]

        img_bytes = base64.b64decode(image_data)
        from PIL import Image
        img = Image.open(BytesIO(img_bytes))

        engine = get_ocr()
        result, _ = engine(img)

        regions = []
        if result:
            for item in result:
                box = item[0]
                text = item[1]
                confidence = item[2]

                x_min = min(p[0] for p in box)
                y_min = min(p[1] for p in box)
                x_max = max(p[0] for p in box)
                y_max = max(p[1] for p in box)

                regions.append(OCRRegion(
                    text=text,
                    confidence=float(confidence),
                    x=float(x_min),
                    y=float(y_min),
                    width=float(x_max - x_min),
                    height=float(y_max - y_min),
                ))

        print(f"[OCR] Found {len(regions)} text regions")
        return OCRResponse(success=True, regions=regions)

    except Exception as e:
        print(f"[OCR] Error: {e}")
        return OCRResponse(success=False, regions=[], error=str(e))


@app.post("/agent/analyze", response_model=AgentResponse)
def agent_analyze(request: AgentRequest):
    return analyze_task(request)


@app.post("/api/agent/plan", response_model=PlanResponse)
def agent_plan(request: PlanRequest):
    """AI agent planning endpoint.

    Accepts a natural language instruction alongside screen context
    (screenshot, DOM, OCR regions, sensitive region metadata) and returns
    a structured, multi-step action plan for the browser extension to execute.

    The backend never directly controls the browser — it only produces the plan.
    """
    return build_plan(request)
