import os
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from schemas.agent import AgentRequest, AgentResponse
from agent.controller import analyze_task

load_dotenv()

app = FastAPI(
    title="Privacy-Preserving AI Agent",
    description="Backend agent API for sanitized screen context"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


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


@app.post("/agent/analyze", response_model=AgentResponse)
def agent_analyze(request: AgentRequest):
    return analyze_task(request)
