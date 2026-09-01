from pydantic import BaseModel, Field
from typing import Any, Dict, List, Literal, Optional


# ---------------------------------------------------------------------------
# Existing schemas — kept intact for /agent/analyze
# ---------------------------------------------------------------------------

class AgentRequest(BaseModel):
    task: str
    screen_context: Optional[str] = None
    sanitized_image: Optional[str] = None
    detected_elements: List[str] = []


class AgentResponse(BaseModel):
    action: str
    target: str = ""
    fields: Dict[str, str]
    requires_confirmation: bool
    explanation: str


class AgentErrorResponse(BaseModel):
    success: bool = False
    error: str


# ---------------------------------------------------------------------------
# New schemas for POST /api/agent/plan
# ---------------------------------------------------------------------------

class OcrRegion(BaseModel):
    """A single text region detected by OCR on the screen."""
    text: str
    x: float
    y: float
    width: float
    height: float
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class SensitiveRegion(BaseModel):
    """Metadata about a sensitive screen region. Values are never exposed."""
    type: str          # e.g. "email", "password", "credit_card", "phone"
    x: float
    y: float
    width: float
    height: float


class PlanRequest(BaseModel):
    """Request body for POST /api/agent/plan."""
    instruction: str = Field(..., min_length=1, description="Natural language user instruction")
    screenshot: Optional[str] = Field(
        default=None,
        description="Base64-encoded screenshot or data URI (e.g. data:image/png;base64,...)"
    )
    dom: Optional[Any] = Field(
        default=None,
        description="DOM structure as a JSON object/tree"
    )
    ocr: List[OcrRegion] = Field(
        default_factory=list,
        description="Structured OCR text regions detected on the screen"
    )
    sensitiveRegions: List[SensitiveRegion] = Field(
        default_factory=list,
        description="Sensitive screen regions (position metadata only, no values)"
    )


class ActionTarget(BaseModel):
    """Describes what element to target for an action."""
    type: Literal["dom", "ocr", "visual"]
    selector: Optional[str] = Field(
        default=None,
        description="CSS selector or aria attribute (used when type=dom)"
    )
    text: Optional[str] = Field(
        default=None,
        description="Exact visible text to match (used when type=ocr)"
    )
    x: Optional[float] = Field(
        default=None,
        description="X coordinate (used when type=ocr or visual)"
    )
    y: Optional[float] = Field(
        default=None,
        description="Y coordinate (used when type=ocr or visual)"
    )


class AgentStep(BaseModel):
    """A single executable step in the action plan."""
    action: Literal["click", "type", "scroll", "keypress", "navigate",
                    "wait", "select", "hover", "back"]
    target: Optional[ActionTarget] = None   # for click, hover, select
    text: Optional[str] = None              # for type
    key: Optional[str] = None              # for keypress (e.g. "ENTER", "TAB")
    milliseconds: Optional[int] = None      # for wait
    direction: Optional[Literal["up", "down", "left", "right"]] = None  # for scroll
    amount: Optional[int] = None            # for scroll (pixels)
    url: Optional[str] = None              # for navigate
    reason: Optional[str] = None           # human-readable explanation


class ActionPlan(BaseModel):
    """Structured action plan returned by the AI agent."""
    goal: str
    steps: List[AgentStep]
    confidence: float = Field(ge=0.0, le=1.0)
    requires_confirmation: bool


class PlanResponse(BaseModel):
    """Response body for POST /api/agent/plan."""
    success: bool
    plan: Optional[ActionPlan] = None
    error: Optional[str] = None
