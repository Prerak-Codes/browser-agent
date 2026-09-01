import os
import json
import re
import httpx


class LLMError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


def call_llm_raw(api_key: str, base_url: str, model: str, messages: list[dict]) -> str:
    """Public API: call the LLM with a pre-built messages list.

    Unlike _call_llm(), this accepts a fully-constructed messages list so
    callers can include vision content blocks, multi-turn history, etc.
    Returns the raw content string from the model.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 1500,
    }

    response = httpx.post(
        f"{base_url}/chat/completions",
        headers=headers,
        json=payload,
        timeout=45.0,
    )

    if response.status_code == 401:
        raise LLMError("Invalid API key", 401)
    if response.status_code == 404:
        raise LLMError(f"Model not found: {model}", 404)
    if response.status_code == 429:
        raise LLMError("Rate limit exceeded", 429)
    if response.status_code >= 500:
        raise LLMError(f"Provider error: {response.status_code}", response.status_code)

    response.raise_for_status()

    data = response.json()
    choice = data.get("choices", [{}])[0]
    message = choice.get("message", {})
    content = message.get("content", "")

    # Some models surface content under alternate keys
    if not content:
        for key in ("reasoning_content", "reasoning", "text", "output", "response"):
            val = message.get(key, "")
            if val and isinstance(val, str):
                content = val
                break

    if not content:
        print(f"[LLM] Empty content from {model}. Choice: {json.dumps(choice)[:300]}")

    return content or ""


def ask_llm(
    task: str,
    screen_context: str,
    detected_elements: list[str]
) -> dict:

    api_key = os.getenv("LLM_API_KEY", "")
    base_url = os.getenv("LLM_BASE_URL", "")
    model = os.getenv("LLM_MODEL", "")

    if not api_key or not base_url or not model:
        print("[Mock LLM] No API key configured, returning mock response")
        return _mock_response(task, detected_elements)

    print(f"[LLM] Calling {model} at {base_url}")

    prompt = _build_prompt(task, screen_context, detected_elements)

    try:
        content = _call_llm(api_key, base_url, model, prompt)

        if not content:
            fallback = os.getenv("LLM_FALLBACK_MODEL", "")
            if fallback and fallback != model:
                print(f"[LLM] Retrying with fallback: {fallback}")
                content = _call_llm(api_key, base_url, fallback, prompt)

        if not content:
            raise LLMError("Empty LLM response")

        return _parse_llm_response(content)

    except httpx.TimeoutException:
        print("[LLM] Request timed out")
        raise LLMError("LLM request timed out")
    except LLMError:
        raise
    except Exception as e:
        print(f"[LLM] Error: {e}")
        raise LLMError(f"LLM request failed: {str(e)}")


def _call_llm(api_key: str, base_url: str, model: str, prompt: str) -> str:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a browser automation assistant. "
                    "You analyze sanitized screenshots and text extracted from web pages. "
                    "You suggest concrete, actionable steps the user can take. "
                    "Always return valid JSON with these keys: "
                    "action (string: click, fill_form, navigate, scroll, type_text, select_option, none), "
                    "target (string: exact button/element text or CSS selector hint), "
                    "fields (object: field names to values for fill_form, empty object otherwise), "
                    "requires_confirmation (boolean), "
                    "explanation (string: 1-3 sentences explaining what you see and what to do)."
                )
            },
            {
                "role": "user",
                "content": prompt
            }
        ],
        "temperature": 0.2,
        "max_tokens": 400
    }

    response = httpx.post(
        f"{base_url}/chat/completions",
        headers=headers,
        json=payload,
        timeout=30.0
    )

    if response.status_code == 401:
        raise LLMError("Invalid API key", 401)
    if response.status_code == 404:
        raise LLMError(f"Model not found: {model}", 404)
    if response.status_code == 429:
        raise LLMError("Rate limit exceeded", 429)
    if response.status_code >= 500:
        raise LLMError(f"Provider error: {response.status_code}", response.status_code)

    response.raise_for_status()

    data = response.json()

    print(f"[LLM] Response keys: {list(data.keys())}")

    choice = data.get("choices", [{}])[0]
    message = choice.get("message", {})
    content = message.get("content", "")

    if not content:
        content = message.get("reasoning_content", "")

    if not content:
        reasoning = message.get("reasoning", "")
        if isinstance(reasoning, str) and reasoning:
            content = reasoning

    if not content and isinstance(message, dict):
        for key in ["text", "output", "response"]:
            if message.get(key):
                content = message[key]
                break

    if not content:
        print(f"[LLM] Empty content. Full choice: {json.dumps(choice)[:500]}")
        print(f"[LLM] Full message: {json.dumps(message)[:500]}")

    return content or ""


def _parse_llm_response(content: str) -> dict:
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        pass

    json_match = re.search(r'\{[\s\S]*\}', content)
    if json_match:
        try:
            return json.loads(json_match.group())
        except json.JSONDecodeError:
            pass

    return {
        "action": "none",
        "target": "",
        "fields": {},
        "requires_confirmation": False,
        "explanation": content.strip()[:500]
    }


def _build_prompt(
    task: str,
    screen_context: str,
    detected_elements: list[str]
) -> str:

    elements_str = "\n".join(f"  - {e}" for e in detected_elements) if detected_elements else "  (none)"

    return (
        f"USER REQUEST: {task}\n\n"
        f"PAGE CONTEXT:\n{screen_context}\n\n"
        f"IDENTIFIED ELEMENTS:\n{elements_str}\n\n"
        f"Based on the page text and identified elements above:\n"
        f"1. Determine what the user wants to accomplish.\n"
        f"2. Find the most relevant interactive element (button, link, form field) that matches the request.\n"
        f"3. Suggest a specific action with the exact element text or description.\n"
        f"4. If form filling is needed, use SAFE placeholder values.\n"
        f"5. If no matching element exists on this page, suggest navigation steps.\n\n"
        f"Return JSON:\n"
        f'{{"action": "click|fill_form|navigate|scroll|type_text|none", '
        f'"target": "exact text or description of the element to interact with", '
        f'"fields": {{"field_name": "SAFE_PLACEHOLDER"}}, '
        f'"requires_confirmation": true, '
        f'"explanation": "concise explanation of what you see and what to do"}}'
    )


def _mock_response(
    task: str,
    detected_elements: list[str]
) -> dict:

    has_form = any(
        "field" in e or "button" in e
        for e in detected_elements
    )

    has_login = any(
        "login" in e or "submit" in e
        for e in detected_elements
    )

    if has_form:
        fields = {}

        if "name_field" in detected_elements:
            fields["name"] = "USER_NAME"

        if "email_field" in detected_elements:
            fields["email"] = "USER_EMAIL"

        if "phone_field" in detected_elements:
            fields["phone"] = "USER_PHONE"

        if "password_field" in detected_elements:
            fields["password"] = "USER_PASSWORD"

        if "credit_card_field" in detected_elements:
            fields["card"] = "USER_CARD"

        return {
            "action": "fill_form",
            "target": "",
            "fields": fields if fields else {"input": "USER_INPUT"},
            "requires_confirmation": True,
            "explanation": (
                "The page appears to contain a form matching "
                "your requested task. Fields have been identified "
                "and safe placeholders are suggested."
            )
        }

    if has_login:
        return {
            "action": "click",
            "target": "login_button",
            "fields": {},
            "requires_confirmation": True,
            "explanation": (
                "A login button was detected. "
                "Clicking it may proceed with the task."
            )
        }

    return {
        "action": "none",
        "target": "",
        "fields": {},
        "requires_confirmation": False,
        "explanation": (
            f"Task: {task}. "
            f"Detected elements: {', '.join(detected_elements) if detected_elements else 'none'}. "
            f"No actionable form elements or buttons were identified on screen. "
            f"The privacy system has sanitized all sensitive data before analysis."
        )
    }
