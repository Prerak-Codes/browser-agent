from pydantic import BaseModel
from typing import List, Dict, Optional


class AgentRequest(BaseModel):
    task: str
    screen_context: Optional[str] = None
    sanitized_image: Optional[str] = None
    detected_elements: List[str] = []


class AgentResponse(BaseModel):
    action: str
    fields: Dict[str, str]
    requires_confirmation: bool
    explanation: str


class AgentErrorResponse(BaseModel):
    success: bool = False
    error: str
