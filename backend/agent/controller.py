from fastapi import HTTPException
from schemas.agent import AgentRequest, AgentResponse
from agent.llm import ask_llm, LLMError
from agent.planner import create_action_plan


def analyze_task(request: AgentRequest) -> AgentResponse:

    print("=" * 50)
    print("Agent request received")
    print(f"Task: {request.task}")
    print(f"Detected elements: {request.detected_elements}")
    print(f"Sanitized context received: {request.screen_context is not None}")
    print(f"Sanitized image received: {request.sanitized_image is not None}")

    screen_context = request.screen_context or ""

    print("Calling LLM...")

    try:
        llm_result = ask_llm(
            task=request.task,
            screen_context=screen_context,
            detected_elements=request.detected_elements
        )
    except LLMError as e:
        print(f"[Agent] LLM error: {e.message}")
        raise HTTPException(
            status_code=e.status_code or 500,
            detail=e.message
        )

    print("Creating action plan...")

    plan = create_action_plan(llm_result)

    print(f"Action proposed: {plan['action']}")
    print(f"Confirmation required: {plan['requires_confirmation']}")
    print("=" * 50)

    return AgentResponse(
        action=plan["action"],
        target=plan.get("target", ""),
        fields=plan["fields"],
        requires_confirmation=plan["requires_confirmation"],
        explanation=plan["explanation"]
    )
