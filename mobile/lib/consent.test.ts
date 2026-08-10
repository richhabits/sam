import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same shape api.demo.test.ts already uses: expo-secure-store reaches react-native, which the
// test runner cannot parse, so the keychain is a Map.
const store = new Map<string, string>();
let failNext = false;
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => {
    if (failNext) throw new Error('keychain unavailable');
    return store.get(k) ?? null;
  },
  setItemAsync: async (k: string, v: string) => {
    if (failNext) throw new Error('keychain unavailable');
    store.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    store.delete(k);
  },
}));

import { consentCopy, couldSpend, loadConsent, needsConsent, setConsent } from './consent';

beforeEach(() => {
  store.clear();
  failNext = false;
});

describe('couldSpend — which tiers are actually a spend', () => {
  it('only turbo reliably spends', () => {
    expect(couldSpend('turbo')).toBe(true);
    expect(couldSpend('free')).toBe(false);
  });

  // The most important assertion in this file. Auto tries free and local brains first and pays
  // only when they cannot do the job, so prompting on auto would put a spend warning in front
  // of the case that usually costs nothing. People would learn to dismiss it unread, and the
  // real prompt would stop being visible. A card that cries wolf is worse than no card.
  it('does NOT treat auto as a spend, because auto is the free-first path', () => {
    expect(couldSpend('auto')).toBe(false);
  });

  it('treats an unknown or missing tier as not-a-spend rather than guessing', () => {
    expect(couldSpend(null)).toBe(false);
    expect(couldSpend(undefined)).toBe(false);
    expect(couldSpend('something-new')).toBe(false);
  });
});

describe('needsConsent — when a send has to stop and ask', () => {
  it('asks the first time a paying tier is used', () => {
    expect(needsConsent('turbo', 'ask')).toBe(true);
  });

  it('stops asking once a standing permission exists', () => {
    expect(needsConsent('turbo', 'always')).toBe(false);
  });

  it('never asks for a tier that cannot spend, whatever the stored permission says', () => {
    for (const tier of ['auto', 'free', null, undefined]) {
      expect(needsConsent(tier, 'ask')).toBe(false);
      expect(needsConsent(tier, 'always')).toBe(false);
    }
  });
});

describe('consentCopy — what it is allowed to claim', () => {
  const { title, body } = consentCopy();

  // SAM does not know what a turn costs until it has run one. An invented figure is how a
  // meter stops being believed, and the meter is the whole free-first argument.
  it('states no price, because no price is known before the turn runs', () => {
    expect(`${title} ${body}`).not.toMatch(/[£$€]\s?\d|\d+\s*(credits?|cents?|pence)/i);
  });

  // The difference between a warning and a choice: naming what the alternative would have been.
  it('names the free alternative rather than only warning', () => {
    expect(body.toLowerCase()).toContain('auto');
    expect(body.toLowerCase()).toMatch(/free/);
  });

  it('points at the meter, so the claim is checkable rather than asserted', () => {
    expect(body.toLowerCase()).toMatch(/meter|tasks/);
  });

  it('says what it is about without shouting', () => {
    expect(title.length).toBeLessThan(48);
    expect(title).not.toMatch(/!|WARNING|CAREFUL/i);
  });
});

describe('the stored grant', () => {
  it('defaults to asking, so a fresh install never spends unasked', async () => {
    expect(await loadConsent()).toBe('ask');
  });

  it('remembers an always-allow across a reload', async () => {
    await setConsent('always');
    expect(await loadConsent()).toBe('always');
  });

  it('can be taken back', async () => {
    await setConsent('always');
    await setConsent('ask');
    expect(await loadConsent()).toBe('ask');
  });

  // The direction a failure has to fall. A keychain read can fail on first unlock after boot,
  // on a restore from backup, or because the OS simply says no — and none of those are consent.
  it('falls back to ASKING when the keychain refuses, never to allowing', async () => {
    await setConsent('always');
    failNext = true;
    expect(await loadConsent()).toBe('ask');
  });

  it('a grant that cannot be written just means being asked again, not a crash', async () => {
    failNext = true;
    await expect(setConsent('always')).resolves.toBeUndefined();
  });
});
