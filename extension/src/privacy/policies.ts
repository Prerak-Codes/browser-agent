export type PrivacyAction = "blur" | "mask" | "redact" | "allow";

export type PrivacyType = string;

export interface CustomPattern {
  name: string;
  regex: string;
}

export interface PrivacyPolicy {
  [key: string]: PrivacyAction;
}

export const BUILT_IN_TYPES: string[] = [
  "face",
  "email",
  "phone",
  "password",
  "credit_card",
  "aadhaar",
];

export const DEFAULT_PRIVACY_POLICY: PrivacyPolicy = {
  face: "blur",
  email: "mask",
  phone: "mask",
  credit_card: "redact",
  password: "redact",
  aadhaar: "mask",
};

const POLICY_KEY = "privacyguard-policy";
const CUSTOM_PATTERNS_KEY = "privacyguard-custom-patterns";
const STATS_KEY = "privacyguard-stats";

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
  for (const key of Object.keys(policy)) {
    if (!isValidAction(policy[key])) return false;
  }
  return true;
}

export async function getPrivacyPolicy(): Promise<PrivacyPolicy> {
  try {
    const stored = await chrome.storage.local.get(POLICY_KEY);
    if (!stored[POLICY_KEY]) {
      return { ...DEFAULT_PRIVACY_POLICY };
    }
    const parsed = JSON.parse(stored[POLICY_KEY]);
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
      [POLICY_KEY]: JSON.stringify(policy),
    });
  } catch (err) {
    console.error("Failed to save policy:", err);
  }
}

export async function getCustomPatterns(): Promise<CustomPattern[]> {
  try {
    const stored = await chrome.storage.local.get(CUSTOM_PATTERNS_KEY);
    if (!stored[CUSTOM_PATTERNS_KEY]) return [];
    return JSON.parse(stored[CUSTOM_PATTERNS_KEY]);
  } catch {
    return [];
  }
}

export async function saveCustomPatterns(
  patterns: CustomPattern[]
): Promise<void> {
  try {
    await chrome.storage.local.set({
      [CUSTOM_PATTERNS_KEY]: JSON.stringify(patterns),
    });
  } catch (err) {
    console.error("Failed to save custom patterns:", err);
  }
}

export async function addCustomPattern(
  name: string,
  regex: string
): Promise<boolean> {
  try {
    new RegExp(regex);
  } catch {
    return false;
  }

  const patterns = await getCustomPatterns();
  if (patterns.some((p) => p.name === name)) return false;
  patterns.push({ name, regex });
  await saveCustomPatterns(patterns);

  const policy = await getPrivacyPolicy();
  if (!policy[name]) {
    policy[name] = "mask";
    await savePrivacyPolicy(policy);
  }

  return true;
}

export async function removeCustomPattern(name: string): Promise<void> {
  const patterns = await getCustomPatterns();
  await saveCustomPatterns(patterns.filter((p) => p.name !== name));

  const policy = await getPrivacyPolicy();
  if (policy[name] !== undefined) {
    delete policy[name];
    await savePrivacyPolicy(policy);
  }
}

export interface LifetimeStats {
  totalCaptures: number;
  totalSanitizations: number;
  totalSentToLLM: number;
  totalSensitiveRegions: number;
}

const DEFAULT_STATS: LifetimeStats = {
  totalCaptures: 0,
  totalSanitizations: 0,
  totalSentToLLM: 0,
  totalSensitiveRegions: 0,
};

export async function getLifetimeStats(): Promise<LifetimeStats> {
  try {
    const stored = await chrome.storage.local.get(STATS_KEY);
    if (!stored[STATS_KEY]) return { ...DEFAULT_STATS };
    return { ...DEFAULT_STATS, ...JSON.parse(stored[STATS_KEY]) };
  } catch {
    return { ...DEFAULT_STATS };
  }
}

export async function updateLifetimeStats(
  updates: Partial<LifetimeStats>
): Promise<void> {
  try {
    const current = await getLifetimeStats();
    const merged: LifetimeStats = {
      totalCaptures: current.totalCaptures + (updates.totalCaptures || 0),
      totalSanitizations: current.totalSanitizations + (updates.totalSanitizations || 0),
      totalSentToLLM: current.totalSentToLLM + (updates.totalSentToLLM || 0),
      totalSensitiveRegions: current.totalSensitiveRegions + (updates.totalSensitiveRegions || 0),
    };
    await chrome.storage.local.set({
      [STATS_KEY]: JSON.stringify(merged),
    });
  } catch (err) {
    console.error("Failed to update stats:", err);
  }
}

const SESSION_KEY = "privacyguard-session";

export interface SessionState {
  screenshot: string | null;
  sanitizedScreenshot: string | null;
  sensitiveRegionsJson: string | null;
  ocrDetectionsJson: string | null;
  visionDetectionsJson: string | null;
}

export async function saveSessionState(
  state: Partial<SessionState>
): Promise<void> {
  try {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    const existing: SessionState = stored[SESSION_KEY]
      ? JSON.parse(stored[SESSION_KEY])
      : {};
    const merged = { ...existing, ...state };
    await chrome.storage.session.set({ [SESSION_KEY]: JSON.stringify(merged) });
  } catch (err) {
    console.error("Failed to save session state:", err);
  }
}

export async function loadSessionState(): Promise<SessionState | null> {
  try {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    if (!stored[SESSION_KEY]) return null;
    return JSON.parse(stored[SESSION_KEY]);
  } catch {
    return null;
  }
}

export async function clearSessionState(): Promise<void> {
  try {
    await chrome.storage.session.remove(SESSION_KEY);
  } catch (err) {
    console.error("Failed to clear session state:", err);
  }
}
