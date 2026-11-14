// Persistent policy tuning used by handback prompts.

const SETTINGS_KEY = 'policySettings';

export interface PolicySettings {
  /** How long browser_request_user waits for the user. */
  handbackTimeoutMs: number;
}

export const DEFAULT_SETTINGS: PolicySettings = {
  handbackTimeoutMs: 600_000,
};

export async function getSettings(): Promise<PolicySettings> {
  const stored = (await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY] as Partial<PolicySettings> | undefined;
  return { ...DEFAULT_SETTINGS, ...stored };
}
