"""
agent/prompt_builder.py
-----------------------
Builds the messages list sent to the LLM for the /api/agent/plan endpoint.

Privacy rules enforced here:
 - Sensitive region VALUES are never included — only type + position metadata.
 - Screenshots are forwarded as an image_url content block (OpenRouter vision).
 - No API keys, passwords, or personal data are logged.
 - DOM is compressed to key attributes only before being sent.
"""

from __future__ import annotations

import json
from typing import Any

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Only these DOM attributes are forwarded to the LLM — everything else stripped
_SAFE_DOM_ATTRS = {
    "tag", "id", "class", "aria-label", "name", "type",
    "href", "role", "placeholder", "value", "data-testid",
    "action", "for", "title", "alt",
}

_MAX_DOM_CHARS = 3_000   # chars after compression
_MAX_OCR_REGIONS = 80    # cap to avoid blowing the context window

# Keywords that indicate destructive intent anywhere in the plan output
DESTRUCTIVE_KEYWORDS = {
    "delete", "send", "submit", "purchase", "transfer", "logout",
    "remove", "clear", "pay", "confirm", "place order", "sign out",
    "change password", "reset", "unsubscribe", "deactivate", "close account",
    "send email", "send message",
}

# ---------------------------------------------------------------------------
# System prompt
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = """\
You are a browser automation AI agent embedded in a privacy-preserving browser extension.

Your output MUST be a single valid JSON object - no markdown, no code fences, no explanation.

OUTPUT SCHEMA:
{
  "goal": "<one-sentence description of what you will accomplish>",
  "steps": [
    {
      "action": "<click|type|scroll|keypress|navigate|wait|select|hover|back>",
      "target": {
        "type": "<dom|ocr|visual>",
        "selector": "<CSS/aria selector>",
        "text": "<exact visible text>",
        "x": <number>,
        "y": <number>
      },
      "text": "<text to type>",
      "key": "<ENTER|TAB|ESCAPE|...>",
      "milliseconds": <number>,
      "direction": "<up|down|left|right>",
      "amount": <pixels>,
      "url": "<URL>",
      "reason": "<why this step is needed>"
    }
  ],
  "confidence": <0.0 to 1.0>,
  "requires_confirmation": <true|false>
}

RULES:
1. TARGET PRIORITY (use the strongest available source):
     DOM selector (type=dom) -> OCR text+coords (type=ocr) -> visual position (type=visual)
   Only use type=dom when you can see a matching selector in the provided DOM.
   Prefer aria-label selectors over class names.

2. SAFETY: set requires_confirmation=true when any step involves:
   delete, send email, submit form, purchase, transfer, logout, change settings,
   reset password, unsubscribe, close account, or any irreversible action.

3. SCROLLING: if a target is likely below the visible area, add a scroll step first.

4. SENSITIVE REGIONS: never interact with elements inside marked sensitive regions
   unless the instruction explicitly requires it, and always require confirmation.

5. CONFIDENCE: reflect genuine uncertainty. If context does not clearly show the
   target, lower confidence accordingly.

6. OUTPUT: return ONLY the JSON object. Nothing before it, nothing after it.
"""

# ---------------------------------------------------------------------------
# DOM compression helpers
# ---------------------------------------------------------------------------

def _compress_dom_node(node: Any, depth: int = 0) -> Any:
    """Recursively strip DOM nodes to safe, essential attributes only."""
    if depth > 8:
        return "..."
    if isinstance(node, str):
        return node[:120] if len(node) > 120 else node
    if isinstance(node, list):
        compressed = [_compress_dom_node(child, depth + 1) for child in node[:30]]
        return [c for c in compressed if c not in (None, {}, [], "")]
    if isinstance(node, dict):
        out: dict[str, Any] = {}
        for attr in _SAFE_DOM_ATTRS:
            if attr in node and node[attr] not in (None, "", False):
                out[attr] = str(node[attr])[:120]
        if "children" in node:
            children = _compress_dom_node(node["children"], depth + 1)
            if children:
                out["children"] = children
        return out
    return node


def _dom_to_text(dom: Any) -> str:
    """Compress and serialise a DOM tree to a short JSON string."""
    compressed = _compress_dom_node(dom)
    text = json.dumps(compressed, separators=(",", ":"))
    if len(text) > _MAX_DOM_CHARS:
        text = text[:_MAX_DOM_CHARS] + "...[truncated]"
    return text


# ---------------------------------------------------------------------------
# Safety helper (also used by plan_controller)
# ---------------------------------------------------------------------------

def has_destructive_intent(plan: dict) -> bool:
    """Return True if the plan goal or any step contains a destructive keyword."""
    corpus = plan.get("goal", "").lower()
    for step in plan.get("steps", []):
        corpus += " " + step.get("action", "").lower()
        corpus += " " + step.get("reason", "").lower()
        corpus += " " + (step.get("text") or "").lower()
    return any(kw in corpus for kw in DESTRUCTIVE_KEYWORDS)


# ---------------------------------------------------------------------------
# Main builder
# ---------------------------------------------------------------------------

def build_plan_messages(
    instruction: str,
    screenshot: "str | None",
    dom: Any,
    ocr: "list[dict]",
    sensitive_regions: "list[dict]",
) -> "list[dict]":
    """Build the OpenRouter-compatible messages list for the plan LLM call.

    Args:
        instruction:       Raw user instruction text.
        screenshot:        Base64 or data-URI screenshot (may be None).
        dom:               DOM tree as a dict/list (may be None).
        ocr:               List of OcrRegion dicts.
        sensitive_regions: List of SensitiveRegion dicts (type+position only).

    Returns:
        List of message dicts ready to pass to call_llm_raw().
    """
    parts: list[str] = []

    # Instruction
    parts.append(f"USER INSTRUCTION: {instruction}\n")

    # DOM
    if dom is not None:
        parts.append("DOM STRUCTURE (essential attributes only):")
        parts.append(_dom_to_text(dom))
        parts.append("")
    else:
        parts.append("DOM STRUCTURE: not provided\n")

    # OCR regions
    capped_ocr = ocr[:_MAX_OCR_REGIONS]
    if capped_ocr:
        parts.append(f"OCR TEXT REGIONS ({len(capped_ocr)} regions visible on screen):")
        for r in capped_ocr:
            txt  = r.get("text", "")
            x    = r.get("x", 0)
            y    = r.get("y", 0)
            w    = r.get("width", 0)
            h    = r.get("height", 0)
            conf = r.get("confidence", 1.0)
            parts.append(f'  "{txt}"  pos=({x},{y})  size={w}x{h}  conf={conf:.2f}')
        parts.append("")
    else:
        parts.append("OCR TEXT REGIONS: none\n")

    # Sensitive regions — metadata only, NO values ever logged or sent
    if sensitive_regions:
        parts.append("SENSITIVE REGIONS (values redacted — do not expose these):")
        for sr in sensitive_regions:
            sr_type = sr.get("type", "unknown")
            x = sr.get("x", 0)
            y = sr.get("y", 0)
            w = sr.get("width", 0)
            h = sr.get("height", 0)
            parts.append(f"  [{sr_type}]  pos=({x},{y})  size={w}x{h}")
        parts.append("")

    text_block = "\n".join(parts)

    # Build user content — text + optional vision block
    if screenshot:
        img_data = screenshot
        mime = "image/png"
        if "," in img_data:
            header, img_data = img_data.split(",", 1)
            if "jpeg" in header or "jpg" in header:
                mime = "image/jpeg"
            elif "webp" in header:
                mime = "image/webp"
            elif "gif" in header:
                mime = "image/gif"

        user_content: Any = [
            {"type": "text", "text": text_block},
            {
                "type": "image_url",
                "image_url": {"url": f"data:{mime};base64,{img_data}"},
            },
        ]
    else:
        user_content = text_block

    return [
        {"role": "system", "content": _SYSTEM_PROMPT},
        {"role": "user",   "content": user_content},
    ]

