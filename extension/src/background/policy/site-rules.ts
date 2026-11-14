/** Returns the hostname used for audit entries and handback prompts. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}
