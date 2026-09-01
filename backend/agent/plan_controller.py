"""
agent/plan_controller.py
------------------------
Orchestrates the POST /api/agent/plan endpoint.

Flow:
  PlanRequest
    -> build_plan_messages()      (prompt_builder)
    -> call_llm_raw()             (llm)
    -> _parse_plan()              JSON extraction with regex fallback
    -> _validate_plan()           structural validation + sanitization
    -> has_destructive_intent()   safety override
    -> PlanResponse
"""

from __future__ import annotations

import json
import os
import re

from fastapi import HTTPException

from schemas.agent import ActionPlan, AgentStep, ActionTarget, PlanRequest, PlanResponse
from agent.llm import call_llm_raw, LLMError
from agent.prompt_builder import build_plan_messages, has_destructive_intent

# Allowed action literals (must match AgentStep schema)
_VALID_ACTIONS = {
    "click", "type", "scroll", "keypress", "navigate",
    "wait", "select", "hover", "back",
}

_VALID_TARGET_TYPES = {"dom", "ocr", "visual"}
_VALID_DIRECTIONS = {"up", "down", "left", "right"}


# ---------------------------------------------------------------------------
# JSON parsing
# ---------------------------------------------------------------------------

def _parse_plan(content: str) -> dict | None:
    """Try to extract a JSON plan dict from the raw LLM response string.

    Strategy:
      1. Direct json.loads on the stripped content.
      2. Regex to find the first {...} block (handles markdown fences etc.).
      3. Return None if both fail.
    """
    content = content.strip()

    # Strip common markdown fences the model may wrap output in
    if content.startswith("```"):
        lines = content.splitlines()
        # Drop first and last fence lines
        inner = "\n".join(
            line for line in lines
            if not line.strip().startswith("```")
        )
        content = inner.strip()

    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass

    # Regex fallback: grab the outermost {...}
    match = re.search(r'\{[\s\S]*\}', content)
    if match:
        try:
            parsed = json.loads(match.group())
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            pass

    return None


# ---------------------------------------------------------------------------
# Structural validation
# ---------------------------------------------------------------------------

def _validate_plan(raw: dict) -> dict:
    """Validate and sanitise the raw plan dict.

    Returns a clean dict suitable for building an ActionPlan.
    Raises ValueError if the plan is fundamentally unusable.
    """
    if not isinstance(raw, dict):
        raise ValueError("LLM plan is not a JSON object")

    goal = str(raw.get("goal") or "Execute user instruction")
    confidence = float(raw.get("confidence") or 0.7)
    confidence = max(0.0, min(1.0, confidence))
    requires_confirmation = bool(raw.get("requires_confirmation", False))

    raw_steps = raw.get("steps")
    if not isinstance(raw_steps, list):
        raw_steps = []

    steps: list[dict] = []
    for s in raw_steps:
        if not isinstance(s, dict):
            continue

        action = str(s.get("action", "")).lower().strip()
        if action not in _VALID_ACTIONS:
            print(f"[Plan] Skipping invalid action: {action!r}")
            continue

        step: dict = {"action": action}

        # Target
        raw_target = s.get("target")
        if isinstance(raw_target, dict):
            t_type = str(raw_target.get("type", "ocr")).lower()
            if t_type not in _VALID_TARGET_TYPES:
                t_type = "ocr"
            target: dict = {"type": t_type}
            if raw_target.get("selector"):
                target["selector"] = str(raw_target["selector"])
            if raw_target.get("text"):
                target["text"] = str(raw_target["text"])
            if raw_target.get("x") is not None:
                try:
                    target["x"] = float(raw_target["x"])
                except (TypeError, ValueError):
                    pass
            if raw_target.get("y") is not None:
                try:
                    target["y"] = float(raw_target["y"])
                except (TypeError, ValueError):
                    pass
            step["target"] = target

        # String scalar fields
        for field in ("text", "key", "reason", "url"):
            val = s.get(field)
            if val is not None:
                step[field] = str(val)

        # Integer scalar fields
        for field in ("milliseconds", "amount"):
            val = s.get(field)
            if val is not None:
                try:
                    step[field] = int(val)
                except (TypeError, ValueError):
                    pass

        # Direction
        direction = str(s.get("direction", "")).lower()
        if direction in _VALID_DIRECTIONS:
            step["direction"] = direction

        steps.append(step)

    return {
        "goal": goal,
        "steps": steps,
        "confidence": confidence,
        "requires_confirmation": requires_confirmation,
    }


# ---------------------------------------------------------------------------
# Mock plan (no API key configured)
# ---------------------------------------------------------------------------

def _mock_plan(request: PlanRequest) -> PlanResponse:
    """Return a reasonable mock plan when no API key is set (development mode)."""
    instruction = request.instruction.lower()
    steps: list[dict] = []
    goal = f"Execute: {request.instruction}"

    if "search" in instruction or "find" in instruction:
        # Prefer a DOM search selector, fall back to OCR
        search_target: dict = {
            "type": "dom",
            "selector": "input[type='search'], [aria-label*='Search' i], [placeholder*='search' i]",
        }
        for region in request.ocr:
            if "search" in region.text.lower():
                search_target = {"type": "ocr", "text": region.text, "x": region.x, "y": region.y}
                break

        steps = [
            {"action": "click",    "target": search_target,             "reason": "Focus search input"},
            {"action": "type",     "text": request.instruction,          "reason": "Enter search query"},
            {"action": "keypress", "key": "ENTER",                       "reason": "Submit search"},
            {"action": "wait",     "milliseconds": 1500,                 "reason": "Wait for results"},
        ]
        goal = f"Search for: {request.instruction}"

    elif "scroll" in instruction:
        steps = [{"action": "scroll", "direction": "down", "amount": 500, "reason": "Scroll to reveal content"}]
        goal = "Scroll page to find target"

    elif "open" in instruction or "click" in instruction:
        target_step: dict | None = None
        words = set(instruction.split())
        for region in request.ocr:
            if any(w in region.text.lower() for w in words if len(w) > 3):
                target_step = {
                    "action": "click",
                    "target": {"type": "ocr", "text": region.text, "x": region.x, "y": region.y},
                    "reason": "Best matching text on screen",
                }
                break
        steps = [target_step] if target_step else [
            {"action": "scroll", "direction": "down", "amount": 300, "reason": "Look for target element"}
        ]
        goal = f"Open: {request.instruction}"

    if not steps:
        steps = [{"action": "scroll", "direction": "down", "amount": 300, "reason": "Explore page"}]

    # Build AgentStep objects
    agent_steps = []
    for s in steps:
        raw_target = s.pop("target", None)
        target_obj = None
        if raw_target:
            target_obj = ActionTarget(**raw_target)
        agent_steps.append(AgentStep(**s, target=target_obj))

    return PlanResponse(
        success=True,
        plan=ActionPlan(
            goal=goal,
            steps=agent_steps,
            confidence=0.5,
            requires_confirmation=False,
        ),
    )


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def build_plan(request: PlanRequest) -> PlanResponse:
    """Build an action plan for the given PlanRequest.

    Called by the POST /api/agent/plan route handler.
    """
    print("=" * 50)
    print(f"[Plan] Instruction: {request.instruction}")
    print(f"[Plan] OCR regions : {len(request.ocr)}")
    print(f"[Plan] Sensitive   : {len(request.sensitiveRegions)}")
    print(f"[Plan] Screenshot  : {'yes' if request.screenshot else 'no'}")
    print(f"[Plan] DOM         : {'yes' if request.dom is not None else 'no'}")

    api_key  = os.getenv("LLM_API_KEY", "")
    base_url = os.getenv("LLM_BASE_URL", "")
    model    = os.getenv("LLM_MODEL", "")

    if not api_key or not base_url or not model:
        print("[Plan] No LLM config — returning mock plan")
        return _mock_plan(request)

    # Build messages for the LLM
    messages = build_plan_messages(
        instruction=request.instruction,
        screenshot=request.screenshot,
        dom=request.dom,
        ocr=[r.model_dump() for r in request.ocr],
        sensitive_regions=[r.model_dump() for r in request.sensitiveRegions],
    )

    print(f"[Plan] Calling model: {model}")

    # Primary call
    content: str = ""
    try:
        content = call_llm_raw(api_key, base_url, model, messages)
    except LLMError as e:
        fallback = os.getenv("LLM_FALLBACK_MODEL", "")
        if fallback and fallback != model:
            print(f"[Plan] Primary failed ({e.message}), trying fallback: {fallback}")
            try:
                content = call_llm_raw(api_key, base_url, fallback, messages)
            except LLMError as e2:
                raise HTTPException(status_code=e2.status_code or 502, detail=e2.message)
        else:
            raise HTTPException(status_code=e.status_code or 502, detail=e.message)

    if not content:
        raise HTTPException(status_code=502, detail="LLM returned an empty response")

    # Parse JSON
    plan_dict = _parse_plan(content)

    # If parsing failed, retry once with fallback model
    if plan_dict is None:
        fallback = os.getenv("LLM_FALLBACK_MODEL", "")
        if fallback and fallback != model:
            print("[Plan] JSON parse failed — retrying with fallback model")
            try:
                content2 = call_llm_raw(api_key, base_url, fallback, messages)
                plan_dict = _parse_plan(content2)
            except LLMError:
                pass

    if plan_dict is None:
        raise HTTPException(
            status_code=502,
            detail="LLM returned malformed JSON that could not be parsed after retry",
        )

    # Validate structure
    try:
        validated = _validate_plan(plan_dict)
    except ValueError as e:
        raise HTTPException(status_code=502, detail=f"Plan validation failed: {e}")

    # Safety override — backend always enforces this, regardless of LLM output
    if has_destructive_intent(validated):
        validated["requires_confirmation"] = True

    print(f"[Plan] Steps: {len(validated['steps'])}, confidence: {validated['confidence']:.2f}")
    print(f"[Plan] Requires confirmation: {validated['requires_confirmation']}")
    print("=" * 50)

    # Build Pydantic objects
    agent_steps = []
    for s in validated["steps"]:
        raw_target = s.pop("target", None)
        target_obj = ActionTarget(**raw_target) if raw_target else None
        agent_steps.append(AgentStep(**s, target=target_obj))

    return PlanResponse(
        success=True,
        plan=ActionPlan(
            goal=validated["goal"],
            steps=agent_steps,
            confidence=validated["confidence"],
            requires_confirmation=validated["requires_confirmation"],
        ),
    )

