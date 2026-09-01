import type { SanitizedContext } from "../utils/context";

export interface AgentResponse {
  action: string;
  target: string;
  fields: Record<string, string>;
  requires_confirmation: boolean;
  explanation: string;
}

export interface AgentError {
  success: false;
  error: string;
}

const API_URL = "http://localhost:8000";

export async function analyzeWithAgent(
  context: SanitizedContext
): Promise<AgentResponse> {
  const payload = createSafeAgentPayload(context);

  const response = await fetch(`${API_URL}/agent/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    const message =
      errorData?.detail || `Backend error: ${response.status}`;
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

  return {
    task: context.task,
    sanitized_image: context.sanitizedImage,
    detected_elements: context.detectedElements,
    screen_context:
      `Page text visible on screen: ${ocrText}\n` +
      `Sensitive regions found: ${context.privacySummary.totalSensitiveRegions}. ` +
      `Types: ${context.privacySummary.types.join(", ") || "none"}.`,
  };
}
