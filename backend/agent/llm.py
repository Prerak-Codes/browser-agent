import os
import json
import re
import httpx


class LLMError(Exception):
    def __init__(self, message: str, status_code: int | None = None):
        self.message = message
        self.status_code = status_code
        super().__init__(message)


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
            raise LLMError("Model not found", 404)
        if response.status_code == 429:
            raise LLMError("Rate limit exceeded", 429)
        if response.status_code >= 500:
            raise LLMError("Provider error", response.status_code)

        response.raise_for_status()

        data = response.json()

        content = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
        )

        if not content:
            raise LLMError("Empty LLM response")

        return _parse_llm_response(content)

    except json.JSONDecodeError:
        print(f"[LLM] Raw response: {content[:500]}")
        raise LLMError("Invalid JSON response from LLM")
    except httpx.TimeoutException:
        print("[LLM] Request timed out")
        raise LLMError("LLM request timed out")
    except LLMError:
        raise
    except Exception as e:
        print(f"[LLM] Error: {e}")
        raise LLMError(f"LLM request failed: {str(e)}")


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
        f"TASK: {task}\n\n"
        f"VISIBLE PAGE TEXT:\n{screen_context}\n\n"
        f"DETECTED UI ELEMENTS:\n{elements_str}\n\n"
        f"Based on the visible text and elements above:\n"
        f"1. Identify the most relevant interactive element for the task.\n"
        f"2. Suggest a specific action (click a button, fill a field, navigate to a link, etc.).\n"
        f"3. If form filling is needed, suggest SAFE placeholder values (e.g. 'USER_NAME', 'USER_EMAIL').\n"
        f"4. If no matching element exists, suggest navigation steps.\n\n"
        f"Return JSON:\n"
        f'{{"action": "click|fill_form|navigate|scroll|type_text|none", '
        f'"target": "exact text of the element to interact with", '
        f'"fields": {{"field_name": "SAFE_PLACEHOLDER"}}, '
        f'"requires_confirmation": true, '
        f'"explanation": "what you found and what to do"}}'
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
