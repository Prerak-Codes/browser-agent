export type PrivacyAction = "blur" | "mask" | "redact" | "allow";

export type PrivacyType =
  | "face"
  | "email"
  | "phone"
  | "password"
  | "credit_card"
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
  aadhaar: "mask",
};

const STORAGE_KEY = "privacyguard-policy";

const VALID_ACTIONS: PrivacyAction[] = ["blur", "mask", "redact", "allow"];

function isValidAction(value: unknown): value is PrivacyAction {
  return (
    typeof value === "string" &&
    VALID_ACTIONS.includes(value as PrivacyAction)
  );
}

function isValidPolicy(obj: unknown): obj is PrivacyPolicy {
  if (typeof obj !== "object" || obj === null) return false;
  const policy = obj as Record<string, unknown>;
  const keys: PrivacyType[] = [
    "face",
    "email",
    "phone",
    "credit_card",
    "password",
    "aadhaar",
  ];
  for (const key of keys) {
    if (!isValidAction(policy[key])) return false;
  }
  return true;
}

export async function getPrivacyPolicy(): Promise<PrivacyPolicy> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    if (!stored[STORAGE_KEY]) {
      return { ...DEFAULT_PRIVACY_POLICY };
    }
    const parsed = JSON.parse(stored[STORAGE_KEY]);
    if (isValidPolicy(parsed)) return parsed;
    console.warn("Invalid policy in storage, using defaults");
    return { ...DEFAULT_PRIVACY_POLICY };
  } catch {
    console.warn("Corrupted policy in storage, using defaults");
    return { ...DEFAULT_PRIVACY_POLICY };
  }
}

export async function savePrivacyPolicy(
  policy: PrivacyPolicy
): Promise<void> {
  try {
    await chrome.storage.local.set({
      [STORAGE_KEY]: JSON.stringify(policy),
    });
  } catch (err) {
    console.error("Failed to save policy:", err);
  }
}

export async function resetPrivacyPolicy(): Promise<void> {
  try {
    await chrome.storage.local.remove(STORAGE_KEY);
  } catch (err) {
    console.error("Failed to reset policy:", err);
  }
}
