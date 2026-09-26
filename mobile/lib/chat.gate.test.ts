import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { store.set(k, v); },
  deleteItemAsync: async (k: string) => { store.delete(k); },
}));
vi.mock('expo/fetch', () => ({ fetch: vi.fn() }));
vi.mock('./api', () => ({ getHost: vi.fn(async () => null), getToken: vi.fn(async () => null) }));
const direct = vi.fn(async () => 'cloud answer');
vi.mock('./direct', () => ({ streamDirectAI: (...a: unknown[]) => (direct as any)(...a) }));

import { AiConsentRequired, grantAiSharing } from './aiConsent';
import { streamChat } from './chat';
import { enterDemo, leaveDemo } from './demo';

beforeEach(async () => {
  store.clear();
  direct.mockClear();
  await leaveDemo();
});

describe('streamChat privacy gate (App Review 5.1.2(i) + demo is offline)', () => {
  it('REFUSES to reach a third-party AI provider without permission', async () => {
    await expect(streamChat('hi', [])).rejects.toBeInstanceOf(AiConsentRequired);
    expect(direct).not.toHaveBeenCalled();
  });
  it('reaches the provider once permission is granted', async () => {
    await grantAiSharing();
    await expect(streamChat('hi', [])).resolves.toBe('cloud answer');
    expect(direct).toHaveBeenCalledTimes(1);
  });
  it('the DEMO answers from the local script and never touches the cloud path — even with no consent', async () => {
    await enterDemo();
    const tokens: string[] = [];
    const done = vi.fn();
    const out = await streamChat('how do I pair?', [], { onToken: (t) => tokens.push(t), onDone: done });
    expect(direct).not.toHaveBeenCalled();
    expect(out).toMatch(/pair/i);
    expect(tokens.length).toBeGreaterThan(1);
    expect(done).toHaveBeenCalledWith(out);
  });
});
