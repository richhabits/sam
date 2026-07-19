import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  acquireLock,
  isStaleLock,
  LockedError,
  lockStatus,
  releaseLock,
  withLockSync,
} from "./statelock.ts";

// The latch's guarantee: of N racers on one resource, exactly ONE wins and the rest fail
// LOUDLY — never a silent overwrite. Stale locks (dead pid / age) are detectable but only an
// EXPLICIT takeover reclaims them; a fresh live lock is never stolen. Uses unique resource names
// per test so the module's real vault/.locks dir stays uncontended and tests don't cross-talk.

let n = 0;
const held: ReturnType<typeof acquireLock>[] = [];
function res() { return `test-lock-${process.pid}-${n++}`; }
afterEach(() => { for (const h of held.splice(0)) { try { releaseLock(h); } catch { /* best-effort cleanup */ } } });

describe("state lock — exactly one writer wins", () => {
  it("a second acquire on a held resource throws LockedError; release frees it", () => {
    const r = res();
    const first = acquireLock(r);
    held.push(first);
    expect(() => acquireLock(r)).toThrow(LockedError);
    // the error names who holds it and since when — never silent.
    try { acquireLock(r); } catch (e) {
      expect(e).toBeInstanceOf(LockedError);
      expect((e as Error).message).toMatch(/state locked by .+ since /);
    }
    releaseLock(first);
    held.pop();
    // now free → re-acquire succeeds.
    const second = acquireLock(r);
    held.push(second);
    expect(second.resource).toBe(r);
  });

  it("N racers: precisely one holds the lock at a time", () => {
    const r = res();
    let wins = 0;
    let losses = 0;
    const winners: ReturnType<typeof acquireLock>[] = [];
    for (let i = 0; i < 5; i++) {
      try { winners.push(acquireLock(r)); wins++; } catch (e) { expect(e).toBeInstanceOf(LockedError); losses++; }
    }
    expect(wins).toBe(1);
    expect(losses).toBe(4);
    winners.forEach(releaseLock);
  });
});

describe("state lock — stale detection + EXPLICIT takeover", () => {
  it("a lock owned by a dead pid is stale, but default acquire still refuses it", () => {
    const r = res();
    const path = join(mkdtempSync(join(tmpdir(), "lock-")), `${r}.lock`);
    const deadInfo = { resource: r, owner: "ghost", pid: 2_147_483_646, host: "old", at: new Date().toISOString(), token: "dead" };
    expect(isStaleLock(deadInfo)).toBe(true); // pid 2^31-2 does not exist → dead
    // Acquire on the REAL resource with a planted stale lock, then verify default refuses + takeover reclaims.
    const first = acquireLock(r); held.push(first);
    // simulate a leftover stale lock by overwriting with a dead-pid holder
    writeFileSync(first.path, JSON.stringify(deadInfo));
    expect(() => acquireLock(r)).toThrow(LockedError); // default: refuse even a stale lock
    try { acquireLock(r); } catch (e) { expect((e as LockedError).stale).toBe(true); }
    const taken = acquireLock(r, { takeover: true }); // EXPLICIT takeover reclaims the stale lock
    held.splice(0, held.length, taken);
    expect(taken.info.owner).not.toBe("ghost");
    expect(path).toContain(".lock"); // (path var kept meaningful)
  });

  it("NEVER takes over a fresh live lock, even with takeover:true", () => {
    const r = res();
    const first = acquireLock(r); held.push(first); // fresh, this live process
    expect(isStaleLock(first.info)).toBe(false);
    expect(() => acquireLock(r, { takeover: true })).toThrow(LockedError); // fresh → refused
  });

  it("release only removes OUR lock — a taken-over holder's release is a no-op", () => {
    const r = res();
    const original = acquireLock(r);
    writeFileSync(original.path, JSON.stringify({ ...original.info, pid: 2_147_483_646, owner: "ghost" }));
    const taker = acquireLock(r, { takeover: true }); held.push(taker);
    releaseLock(original); // original no longer owns it → must NOT delete the taker's lock
    expect(lockStatus(r)?.owner).toBe(taker.info.owner);
  });
});

describe("state lock — withLockSync wrapper", () => {
  it("runs fn under the lock and releases after, even on throw", () => {
    const r = res();
    expect(withLockSync(r, () => 42)).toBe(42);
    expect(lockStatus(r)).toBeNull(); // released
    expect(() => withLockSync(r, () => { throw new Error("boom"); })).toThrow("boom");
    expect(lockStatus(r)).toBeNull(); // released even though fn threw
  });
});
