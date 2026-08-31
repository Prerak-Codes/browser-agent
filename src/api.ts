import type {
    SanitizedContext
} from "./context";


export interface AgentResponse {
    action: string;
    fields: Record<string, string>;
    requires_confirmation: boolean;
    explanation: string;
}


const API_URL =
    import.meta.env.VITE_API_URL ||
    "http://localhost:8000";


export async function analyzeWithAgent(
    context: SanitizedContext
): Promise<AgentResponse> {

    const payload =
        createSafeAgentPayload(context);

    const response =
        await fetch(
            `${API_URL}/agent/analyze`,
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json"
                },
                body: JSON.stringify(
                    payload
                )
            }
        );

    if (!response.ok) {
        throw new Error(
            `Backend error: ${response.status}`
        );
    }

    return response.json();
}


export function createSafeAgentPayload(
    context: SanitizedContext
): {
    task: string;
    sanitized_image?: string;
    detected_elements: string[];
    screen_context: string;
} {

    return {
        task: context.task,
        sanitized_image:
            context.sanitizedImage,
        detected_elements:
            context.detectedElements,
        screen_context:
            `Sensitive regions: ${context.privacySummary.totalSensitiveRegions}. ` +
            `Types: ${context.privacySummary.types.join(", ")}.`
    };
}
