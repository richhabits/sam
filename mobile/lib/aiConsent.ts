import * as SecureStore from 'expo-secure-store';

// SHARING WITH THIRD-PARTY AI — DISCLOSE, NAME, ASK, BEFORE THE FIRST SEND.
//
// App Review Guideline 5.1.2(i) (Nov 2025): an app must clearly disclose where personal data is
// shared with third parties, INCLUDING third-party AI, and obtain explicit permission first.
//
// This is a different question from lib/consent.ts, which asks before SPENDING money. A free
// brain never trips that one — but a free brain is still somebody else's server. In Standalone
// mode (no computer paired, or the computer is unreachable) the phone sends what you type, and
// any text from an attachment, straight to AI providers: keyless public lanes out of the box,
// and any provider you add a key for. That is the moment this gate sits in front of.
//
// Not covered here, on purpose: a paired computer. Then the message goes to the operator's OWN
// machine, running their own software; it is not a third party. (If that machine is unreachable
// and the app falls back to Standalone, the fallback reaches the same gate.)
//
// Fails toward ASKING: a keychain that will not answer means "not granted".

const KEY = 'sam.ai.sharing';

/** Thrown by the chat transport instead of sending. The screen catches it and shows the card. */
export class AiConsentRequired extends Error {
  constructor() {
    super('Permission is needed before messages are sent to cloud AI providers.');
    this.name = 'AiConsentRequired';
  }
}

export async function hasAiSharingConsent(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(KEY)) === 'granted';
  } catch {
    return false;
  }
}

export async function grantAiSharing(): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, 'granted');
  } catch {
    /* best-effort: a grant that fails to persist just means being asked again, which is safe */
  }
}

export async function revokeAiSharing(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    /* the next send re-reads the keychain; a failed delete is retried by asking again */
  }
}

/** What the card says. Names the recipients and the data, per 5.1.2(i) — not "some providers". */
export function aiSharingCopy(): { title: string; body: string } {
  return {
    title: 'Send your messages to cloud AI?',
    body:
      "You're not connected to your own computer, so SAM will send what you type — and text from anything you attach — to third-party AI services to write the answer. " +
      'Out of the box that is Pollinations and OpenRouter (free, no key). If you add your own keys in Settings, it can also be Groq, Cerebras, Mistral, Google Gemini, Anthropic, DeepSeek and the other providers listed there. ' +
      'Each provider handles your message under its own privacy policy. SAM has no servers and receives none of it. You can turn this off any time in Settings.',
  };
}
