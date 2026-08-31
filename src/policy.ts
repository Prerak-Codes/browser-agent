export type PrivacyAction =
    | "blur"
    | "mask"
    | "redact"
    | "allow";

export type PrivacyType =
    | "face"
    | "email"
    | "phone"
    | "credit_card"
    | "password"
    | "aadhaar";

export interface PrivacyPolicy {
    face: PrivacyAction;
    email: PrivacyAction;
    phone: PrivacyAction;
    credit_card: PrivacyAction;
    password: PrivacyAction;
    aadhaar: PrivacyAction;
}

export const DEFAULT_PRIVACY_POLICY: PrivacyPolicy = {
    face: "blur",
    email: "mask",
    phone: "mask",
    credit_card: "redact",
    password: "redact",
    aadhaar: "mask"
};

const STORAGE_KEY = "privacy-agent-policy";

const VALID_ACTIONS: PrivacyAction[] = [
    "blur",
    "mask",
    "redact",
    "allow"
];

function isValidAction(
    value: unknown
): value is PrivacyAction {
    return (
        typeof value === "string" &&
        VALID_ACTIONS.includes(
            value as PrivacyAction
        )
    );
}

function isValidPolicy(
    obj: unknown
): obj is PrivacyPolicy {
    if (
        typeof obj !== "object" ||
        obj === null
    ) {
        return false;
    }

    const policy =
        obj as Record<string, unknown>;

    const keys: PrivacyType[] = [
        "face",
        "email",
        "phone",
        "credit_card",
        "password",
        "aadhaar"
    ];

    for (const key of keys) {
        if (
            !isValidAction(policy[key])
        ) {
            return false;
        }
    }

    return true;
}

export function getPrivacyPolicy(): PrivacyPolicy {

    try {
        const stored =
            localStorage.getItem(
                STORAGE_KEY
            );

        if (!stored) {
            return {
                ...DEFAULT_PRIVACY_POLICY
            };
        }

        const parsed =
            JSON.parse(stored);

        if (isValidPolicy(parsed)) {
            return parsed;
        }

        console.warn(
            "Invalid policy in localStorage, using defaults"
        );

        return {
            ...DEFAULT_PRIVACY_POLICY
        };

    } catch {
        console.warn(
            "Corrupted policy in localStorage, using defaults"
        );

        return {
            ...DEFAULT_PRIVACY_POLICY
        };
    }
}

export function savePrivacyPolicy(
    policy: PrivacyPolicy
): void {

    try {
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(policy)
        );
    } catch (err) {
        console.error(
            "Failed to save policy:",
            err
        );
    }
}

export function resetPrivacyPolicy(): void {

    try {
        localStorage.removeItem(
            STORAGE_KEY
        );
    } catch (err) {
        console.error(
            "Failed to reset policy:",
            err
        );
    }
}
