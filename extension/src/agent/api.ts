import type { SanitizedContext } from "../utils/context";

export interface ActionTarget {
  type: "dom" | "ocr" | "visual";
  selector?: string;
  text?: string;
  x?: number;
  y?: number;
}

export interface AgentStep {
  action: "click" | "type" | "scroll" | "keypress" | "navigate" | "wait" | "select" | "hover" | "back";
  target?: ActionTarget;
  text?: string;
  key?: string;
  milliseconds?: number;
  direction?: "up" | "down" | "left" | "right";
  amount?: number;
  url?: string;
  reason?: string;
}

export interface ActionPlan {
  goal: string;
  steps: AgentStep[];
  confidence: number;
  requires_confirmation: boolean;
}

export interface AgentPlanResponse {
  success: boolean;
  plan?: ActionPlan;
  error?: string;
}

export interface AgentResponse {
  action: string;
  target: string;
  fields: Record<string, string>;
  requires_confirmation: boolean;
  explanation: string;
  plan?: ActionPlan;
}

const API_URL = "http://localhost:8000";

export async function analyzeWithAgent(
  context: SanitizedContext
): Promise<AgentResponse> {
  // First try the new structured planning endpoint
  try {
    const ocrRegions = context.ocrDetections || [];
    const sensRegions = (context.privacySummary?.types || []).map(t => ({
      type: t,
      x: 0, y: 0, width: 0, height: 0
    }));

    const planPayload = {
      instruction: context.task,
      screenshot: context.sanitizedImage,
      dom: null,
      ocr: ocrRegions,
      sensitiveRegions: sensRegions
    };

    const res = await fetch(`${API_URL}/api/agent/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(planPayload)
    });

    if (res.ok) {
      const data: AgentPlanResponse = await res.json();
      if (data.success && data.plan) {
        const firstStep = data.plan.steps[0];
        let actionStr = firstStep ? firstStep.action : "none";
        let targetStr = "";
        if (firstStep?.target) {
          targetStr = firstStep.target.selector || firstStep.target.text || `${firstStep.target.x},${firstStep.target.y}`;
        }
        let fields: Record<string, string> = {};
        if (firstStep?.action === "type" && firstStep.text) {
          fields["input"] = firstStep.text;
        }

        return {
          action: actionStr,
          target: targetStr,
          fields: fields,
          requires_confirmation: data.plan.requires_confirmation,
          explanation: `${data.plan.goal}. ${firstStep?.reason || ""}`,
          plan: data.plan
        };
      }
    }
  } catch (e) {
    console.warn("[Agent API] /api/agent/plan call failed, falling back to /agent/analyze", e);
  }

  // Fallback to legacy endpoint
  const payload = createSafeAgentPayload(context);
  const response = await fetch(`${API_URL}/agent/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    const message = errorData?.detail || `Backend error: ${response.status}`;
    throw new Error(message);
  }

  return response.json();
}

export function createSafeAgentPayload(context: SanitizedContext): {
  task: string;
  sanitized_image?: string;
  detected_elements: string[];
  screen_context: string;
} {
  const ocrText = context.ocrTexts.length > 0
    ? context.ocrTexts.join("; ")
    : "No text detected on screen.";

  const hostname = context.hostname || "unknown page";
  const types = context.privacySummary.types;

  return {
    task: context.task,
    sanitized_image: context.sanitizedImage,
    detected_elements: context.detectedElements,
    screen_context:
      `Website: ${hostname}\n` +
      `Page text: ${ocrText}\n` +
      `Sensitive data detected: ${types.length > 0 ? types.join(", ") : "none"}.`,
  };
}

