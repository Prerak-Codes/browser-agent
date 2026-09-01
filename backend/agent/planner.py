SAFE_ACTIONS = {
    "fill_form",
    "click",
    "navigate",
    "scroll",
    "type_text",
    "select_option",
    "none"
}


def create_action_plan(llm_result: dict) -> dict:

    action = llm_result.get("action", "none")

    if action not in SAFE_ACTIONS:
        print(f"[Planner] Rejected unsafe action: {action}")
        return {
            "action": "none",
            "target": "",
            "fields": {},
            "requires_confirmation": False,
            "explanation": (
                f"Action '{action}' is not in the "
                f"approved action list. Rejected for safety."
            )
        }

    fields = llm_result.get("fields", {})

    if not isinstance(fields, dict):
        fields = {}

    target = llm_result.get("target", "")
    if not isinstance(target, str):
        target = ""

    requires_confirmation = action != "none"

    explanation = llm_result.get(
        "explanation",
        "Action planned from sanitized context."
    )

    return {
        "action": action,
        "target": target,
        "fields": fields,
        "requires_confirmation": requires_confirmation,
        "explanation": explanation
    }
