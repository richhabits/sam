/** First-run is a skippable hello — chat is the app. Never a setup wall. */

export const ONBOARDED_KEY = "sam.onboarded";
export const PROFILE_KEY = "sam.profile";

type StorageGet = Pick<Storage, "getItem">;
type StorageSet = Pick<Storage, "setItem">;

export function loadOnboarded(storage: StorageGet = localStorage): boolean {
  try {
    if (storage.getItem(ONBOARDED_KEY) === "1") return true;
    const raw = storage.getItem(PROFILE_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw) as { name?: unknown };
    return typeof p.name === "string" && p.name.trim().length > 0;
  } catch {
    return false;
  }
}

export function markOnboarded(storage: StorageSet = localStorage): void {
  try {
    storage.setItem(ONBOARDED_KEY, "1");
  } catch {
    /* storage full, disabled or corrupt — the in-memory flag still lets them into chat */
  }
}

/** Named first-run gets a greeting. Skip lands on chips so the first tap is the demo. */
export function seedWelcomeOnFinish(name: string): boolean {
  return name.trim().length > 0;
}

export function welcomeText(name: string): string {
  const who = name.trim();
  if (who) {
    return `Hey ${who} 👋 I'm **SAM**. Chat is the app — I start on a **free lane** (or local Ollama if you have it). Ask me anything.\n\n_Want it faster? Tap **🔑** up top. Never required._`;
  }
  return "Hey 👋 I'm **SAM**. Chat is the app — I start on a **free lane**. Ask me anything, or tap a chip to watch me work.";
}
