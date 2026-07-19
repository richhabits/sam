import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claim,
  isStale,
  LatchHeld,
  latchStatus,
  release,
  withLatchSync,
} from "./latch.ts";

// The latch's guarantee: of N racers on one resource, exactly ONE wins and the rest fail
// LOUDLY — never a silent overwrite. Stale locks (dead pid / age) are detectable but only an
// EXPLICIT takeover reclaims them; a fresh live lock is never stolen. Uses unique resource names
// per test so the module's real vault/.locks dir stays uncontended and tests don't cross-talk.

let n = 0;
const held: ReturnType<typeof claim>[] = [];
function res() { return `test-lock-${process.pid}-${n++}`; }
afterEach(() => { for (const h of held.splice(0)) { try { release(h); } catch { /* best-effort cleanup */ } } });

describe("latch — exactly one writer wins", () => {
  it("a second acquire on a held resource throws LatchHeld; release frees it", () => {
    const r = res();
    const first = claim(r);
    held.push(first);
    expect(() => claim(r)).toThrow(LatchHeld);
    // the error names who holds it and since when — never silent.
    try { claim(r); } catch (e) {
      expect(e).toBeInstanceOf(LatchHeld);
      expect((e as Error).message).toMatch(/the latch is held by .+ since /);
    }
    release(first);
    held.pop();
    // now free → re-acquire succeeds.
    const second = claim(r);
    held.push(second);
    expect(second.resource).toBe(r);
  });

  it("N racers: precisely one holds the lock at a time", () => {
    const r = res();
    let wins = 0;
    let losses = 0;
    const winners: ReturnType<typeof claim>[] = [];
    for (let i = 0; i < 5; i++) {
      try { winners.push(claim(r)); wins++; } catch (e) { expect(e).toBeInstanceOf(LatchHeld); losses++; }
    }
    expect(wins).toBe(1);
    expect(losses).toBe(4);
    winners.forEach(release);
  });
});

describe("latch — stale detection + EXPLICIT takeover", () => {
  it("a lock owned by a dead pid is stale, but default acquire still refuses it", () => {
    const r = res();
    const path = join(mkdtempSync(join(tmpdir(), "lock-")), `${r}.lock`);
    const deadInfo = { resource: r, owner: "ghost", pid: 2_147_483_646, host: "old", at: new Date().toISOString(), token: "dead" };
    expect(isStale(deadInfo)).toBe(true); // pid 2^31-2 does not exist → dead
    // Acquire on the REAL resource with a planted stale lock, then verify default refuses + takeover reclaims.
    const first = claim(r); held.push(first);
    // simulate a leftover stale lock by overwriting with a dead-pid holder
    writeFileSync(first.path, JSON.stringify(deadInfo));
    expect(() => claim(r)).toThrow(LatchHeld); // default: refuse even a stale lock
    try { claim(r); } catch (e) { expect((e as LatchHeld).stale).toBe(true); }
    const taken = claim(r, { takeover: true }); // EXPLICIT takeover reclaims the stale lock
    held.splice(0, held.length, taken);
    expect(taken.info.owner).not.toBe("ghost");
    expect(path).toContain(".lock"); // (path var kept meaningful)
  });

  it("NEVER takes over a fresh live lock, even with takeover:true", () => {
    const r = res();
    const first = claim(r); held.push(first); // fresh, this live process
    expect(isStale(first.info)).toBe(false);
    expect(() => claim(r, { takeover: true })).toThrow(LatchHeld); // fresh → refused
  });

  it("release only removes OUR lock — a taken-over holder's release is a no-op", () => {
    const r = res();
    const original = claim(r);
    writeFileSync(original.path, JSON.stringify({ ...original.info, pid: 2_147_483_646, owner: "ghost" }));
    const taker = claim(r, { takeover: true }); held.push(taker);
    release(original); // original no longer owns it → must NOT delete the taker's lock
    expect(latchStatus(r)?.owner).toBe(taker.info.owner);
  });
});

describe("latch — withLatchSync wrapper", () => {
  it("runs fn under the lock and releases after, even on throw", () => {
    const r = res();
    expect(withLatchSync(r, () => 42)).toBe(42);
    expect(latchStatus(r)).toBeNull(); // released
    expect(() => withLatchSync(r, () => { throw new Error("boom"); })).toThrow("boom");
    expect(latchStatus(r)).toBeNull(); // released even though fn threw
  });
});
