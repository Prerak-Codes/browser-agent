import os
import json
import httpx


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

    prompt = _build_prompt(
        task,
        screen_context,
        detected_elements
    )

    try:
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
                        "You are a privacy-preserving AI agent. "
                        "You receive ONLY sanitized screen context. "
                        "You never receive raw screenshots or sensitive data. "
                        "Return a JSON object with: action, fields, requires_confirmation, explanation."
                    )
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            "temperature": 0.3,
            "max_tokens": 500
        }

        response = httpx.post(
            f"{base_url}/chat/completions",
            headers=headers,
            json=payload,
            timeout=30.0
        )

        response.raise_for_status()

        data = response.json()

        content = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )

        return json.loads(content)

    except Exception as e:
        print(f"[LLM] Error: {e}")
        print("[LLM] Falling back to mock response")
        return _mock_response(task, detected_elements)


def _build_prompt(
    task: str,
    screen_context: str,
    detected_elements: list[str]
) -> str:

    elements_str = ", ".join(detected_elements) if detected_elements else "none detected"

    return (
        f"Task: {task}\n"
        f"Screen context: {screen_context}\n"
        f"Detected UI elements: {elements_str}\n\n"
        f"Return JSON: {{\"action\": \"fill_form|click|navigate|none\", "
        f"\"fields\": {{\"field_name\": \"SAFE_PLACEHOLDER\"}}, "
        f"\"requires_confirmation\": true, "
        f"\"explanation\": \"brief explanation\"}}"
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
            "fields": {"target": "login_button"},
            "requires_confirmation": True,
            "explanation": (
                "A login button was detected. "
                "Clicking it may proceed with the task."
            )
        }

    return {
        "action": "none",
        "fields": {},
        "requires_confirmation": False,
        "explanation": (
            "Could not determine an appropriate action "
            "from the available screen context."
        )
    }
