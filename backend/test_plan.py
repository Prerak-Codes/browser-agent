import json
from schemas.agent import PlanRequest, OcrRegion, SensitiveRegion
from agent.plan_controller import build_plan

ocr_data = [
    OcrRegion(text="TCS Campus Placement", x=144, y=208, width=300, height=30, confidence=0.95),
    OcrRegion(text="Search mail", x=50, y=20, width=120, height=25, confidence=0.99),
    OcrRegion(text="Internship Offer - Infosys", x=144, y=350, width=280, height=30, confidence=0.88),
]
sens = [SensitiveRegion(type="email", x=300, y=210, width=150, height=25)]

instructions = [
    "Find the TCS email and open it",
    "Search Gmail for TCS emails",
    "Scroll down and find the internship email",
    "Open the latest email from TCS",
]

for instr in instructions:
    req = PlanRequest(instruction=instr, ocr=ocr_data, sensitiveRegions=sens)
    resp = build_plan(req)
    plan = resp.plan
    print(f"\n=== {instr!r} ===")
    print(f"  success={resp.success}")
    print(f"  goal={plan.goal!r}")
    print(f"  steps={len(plan.steps)}, confidence={plan.confidence}")
    for i, step in enumerate(plan.steps, 1):
        if step.target:
            tgt_info = f"{step.target.type}:{step.target.text or step.target.selector or ''}"
        else:
            tgt_info = "none"
        print(f"    {i}. {step.action}  target={tgt_info}")
    print(f"  requires_confirmation={plan.requires_confirmation}")
    json_out = resp.model_dump_json(indent=2)
    parsed = json.loads(json_out)
    assert parsed["success"] is True, "success must be True"
    assert "plan" in parsed, "plan key missing"
    assert "steps" in parsed["plan"], "steps key missing"
    print("  JSON serialization: OK")

print("\nAll 4 test cases passed.")
