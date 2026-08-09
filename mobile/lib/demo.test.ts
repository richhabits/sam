import { beforeEach, describe, expect, it, vi } from 'vitest';

// expo-secure-store is the Keychain — a native module with no Node implementation. The demo
// flag is the only thing these tests need from it, so it becomes a plain in-memory map.
const store = new Map<string, string>();
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => store.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => { store.set(k, v); },
  deleteItemAsync: async (k: string) => { store.delete(k); },
}));

import { demoAnswer, demoApi, demoStream, enterDemo, isDemo, leaveDemo, loadDemo } from './demo';

beforeEach(async () => {
  store.clear();
  await leaveDemo();
});

describe('the demo is off unless it is asked for', () => {
  it('starts off', () => {
    expect(isDemo()).toBe(false);
  });

  it('turns on, survives a relaunch, and turns off again', async () => {
    await enterDemo();
    expect(isDemo()).toBe(true);

    // A relaunch: the flag is gone from memory and has to come back from the Keychain, which
    // is the whole reason it is persisted — a demo that silently ended on reopen would drop
    // someone back to a pairing form with no explanation.
    await leaveDemo();
    store.set('sam.demo', '1');
    expect(await loadDemo()).toBe(true);
    expect(isDemo()).toBe(true);

    await leaveDemo();
    expect(isDemo()).toBe(false);
    expect(store.has('sam.demo')).toBe(false);
  });

  it('treats an unreadable Keychain as "not in demo" rather than throwing', async () => {
    const mod = await import('expo-secure-store');
    const spy = vi.spyOn(mod, 'getItemAsync').mockRejectedValueOnce(new Error('keychain unavailable'));
    await expect(loadDemo()).resolves.toBe(false);
    spy.mockRestore();
  });
});

describe('the demo answers the shapes the screens actually read', () => {
  it('gives the yard the fields TasksScreen destructures', () => {
    const y = demoApi('/api/yard');
    expect(y.on).toBe(true);
    expect(Array.isArray(y.recent)).toBe(true);
    expect(y.recent.length).toBeGreaterThan(0);
    for (const j of y.recent) {
      expect(typeof j.id).toBe('string');
      expect(typeof j.kind).toBe('string');
      expect(typeof j.createdAt).toBe('number');
      expect(['queued', 'running', 'done', 'failed', 'cancelled']).toContain(j.state);
    }
    // The counts are what the header renders; they must agree with the list or the screen
    // contradicts itself in the one place a reviewer is looking.
    const byState = (s: string) => y.recent.filter((j: any) => j.state === s).length;
    expect(y.done).toBe(byState('done'));
    expect(y.failed).toBe(byState('failed'));
    expect(y.running).toBe(byState('running'));
  });

  it('looks a job up by id and carries its log', () => {
    const { job, log } = demoApi('/api/yard/job/demo_job_teahouse');
    expect(job?.id).toBe('demo_job_teahouse');
    expect(log.length).toBeGreaterThan(0);
  });

  it('does not pretend to know a job it has never heard of', () => {
    expect(demoApi('/api/yard/job/nope').job).toBeNull();
  });

  it('gives Settings its devices', () => {
    expect(demoApi('/api/pair/devices').devices.length).toBeGreaterThan(0);
  });

  it('says so plainly for a path it has no data for, rather than returning nothing', () => {
    const r = demoApi('/api/something-new');
    expect(r.demo).toBe(true);
    expect(typeof r.note).toBe('string');
  });
});

describe('the demo talks', () => {
  it('answers, and admits it is scripted when it has nothing better', () => {
    expect(demoAnswer('who are you?')).toMatch(/SAM/);
    expect(demoAnswer('what about my tasks')).toMatch(/Tasks/);
    expect(demoAnswer('how do I pair this?')).toMatch(/Pair a device/);
    // The fallback must not bluff — an obviously-unrelated reply that claims to be thinking
    // is the thing that makes a demo feel broken instead of honest.
    expect(demoAnswer('xyzzy plugh')).toMatch(/demo/i);
  });

  // The singular/plural trap that this suite already caught once: the tab is called "Tasks",
  // and \btask\b does not match it. Every noun the app itself puts on screen must land.
  it('matches the words the UI actually shows, plural included', () => {
    for (const q of ['tasks', 'my jobs', 'the builds', 'what did it cost', 'how many tokens', 'is my data private']) {
      expect(demoAnswer(q), `"${q}" fell through to the fallback`).not.toMatch(/answering from a short script/);
    }
  });

  it('streams the answer and reassembles it EXACTLY, whitespace included', async () => {
    const seen: string[] = [];
    const final = await demoStream('hello', (soFar) => seen.push(soFar));
    expect(final).toBe(demoAnswer('hello'));
    // the accumulator is what the UI renders, so the last frame must equal the answer
    expect(seen[seen.length - 1]).toBe(final);
    expect(seen.length).toBeGreaterThan(3);   // it really did arrive in pieces
  });

  it('stops when aborted', async () => {
    const c = new AbortController();
    let frames = 0;
    const p = demoStream('tell me about privacy', () => { frames++; if (frames === 2) c.abort(); }, c.signal);
    const out = await p;
    expect(out.length).toBeLessThan(demoAnswer('tell me about privacy').length);
  });
});
