import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let keychainBroken = false;
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => {
    if (keychainBroken) throw new Error('keychain unavailable');
    return store.get(k) ?? null;
  },
  setItemAsync: async (k: string, v: string) => {
    if (keychainBroken) throw new Error('keychain unavailable');
    store.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    if (keychainBroken) throw new Error('keychain unavailable');
    store.delete(k);
  },
}));

import { AiConsentRequired, aiSharingCopy, grantAiSharing, hasAiSharingConsent, revokeAiSharing } from './aiConsent';

beforeEach(() => {
  store.clear();
  keychainBroken = false;
});

describe('AI data-sharing consent (App Review 5.1.2(i))', () => {
  it('is NOT granted by default', async () => {
    expect(await hasAiSharingConsent()).toBe(false);
  });
  it('grant then revoke round-trips', async () => {
    await grantAiSharing();
    expect(await hasAiSharingConsent()).toBe(true);
    await revokeAiSharing();
    expect(await hasAiSharingConsent()).toBe(false);
  });
  it('fails toward ASKING when the keychain will not answer', async () => {
    await grantAiSharing();
    keychainBroken = true;
    expect(await hasAiSharingConsent()).toBe(false);
  });
  it('a failed grant write does not throw and does not count as granted', async () => {
    keychainBroken = true;
    await expect(grantAiSharing()).resolves.toBeUndefined();
    keychainBroken = false;
    expect(await hasAiSharingConsent()).toBe(false);
  });
  it('the card names the recipients and the data, not just "some providers"', () => {
    const { title, body } = aiSharingCopy();
    expect(title).toMatch(/cloud AI/i);
    for (const name of ['Pollinations', 'OpenRouter', 'Groq', 'Gemini', 'Anthropic', 'DeepSeek']) expect(body).toContain(name);
    expect(body).toMatch(/what you type/i);
    expect(body).toMatch(/privacy policy/i);
    expect(body).toMatch(/no servers/i);
  });
  it('AiConsentRequired is identifiable by name and by class', () => {
    const e = new AiConsentRequired();
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('AiConsentRequired');
  });
});
