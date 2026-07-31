import { describe, expect, it } from 'vitest';
import { scrub as serverScrub } from '../../server/scrub.ts';
import { safeBody, scrub } from './scrub.ts';

// A second copy of a security rule is only safe if something forces the copies to agree.
// This suite is that force: it runs the SAME inputs through the phone's scrubber and the
// server's, and fails if they ever disagree — so adding a shape to server/scrub.ts without
// adding it here breaks the build instead of silently leaving the lock screen unprotected.

// Compare against the server scrubber with an EMPTY environment, so only the by-shape half is
// in play — the by-reference half reads real env vars and is deliberately not ported (see
// lib/scrub.ts). With the real env, this machine's own keys would redact in one and not the
// other and the comparison would prove nothing.
const NO_ENV = {} as NodeJS.ProcessEnv;

const CREDENTIALS = [
  'sk-ant-api03-abcdefghijklmnop1234567890',
  'sk-or-v1-abcdefghijklmnopqrstuvwxyz01',
  'sk-proj-abcdefghijklmnopqrstuvwxyz01',
  'sk-abcdefghijklmnopqrstuvwxyz0123',
  'gsk_abcdefghijklmnopqrstuvwxyz01',
  'vcp_abcdefghijklmnopqrstuvwxyz01',
  'csk-abcdefghijklmnopqrstuvwxyz01',
  'nvapi-abcdefghijklmnopqrstuvwxyz01',
  'AIzaSyAbcdefghijklmnopqrstuvwxyz0123456',
  'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
  'github_pat_abcdefghijklmnopqrstu',
  'xoxb-1234567890-abcdefghij',
  'Bearer abcdefghijklmnopqrstuvwxyz0123',
  'a'.repeat(40), // long hex — this is the shape OUR OWN session token would take
];

describe('the phone scrubber matches the server scrubber, shape for shape', () => {
  for (const secret of CREDENTIALS) {
    it(`redacts ${secret.slice(0, 12)}… identically`, () => {
      const line = `task finished: ${secret} was used`;
      expect(scrub(line)).toBe(serverScrub(line, NO_ENV));
      expect(scrub(line)).not.toContain(secret);
    });
  }

  it('leaves ordinary text completely alone', () => {
    const line = 'Deploy finished — mainline-provisions, 3 files changed';
    expect(scrub(line)).toBe(line);
    expect(scrub(line)).toBe(serverScrub(line, NO_ENV));
  });
});

describe('safeBody — what a lock screen is allowed to show', () => {
  it('never names the operator’s home directory', () => {
    expect(safeBody('wrote /Users/romeovalentine/SAM/vault/keys.json')).toBe(
      'wrote ~/SAM/vault/keys.json',
    );
    expect(safeBody('wrote /home/romeo/notes.md')).toBe('wrote ~/notes.md');
  });

  it('strips markdown so a body renders as plain text, not backticks', () => {
    expect(safeBody('**Done** — see `report.md`')).toBe('Done — see report.md');
  });

  it('caps the length — a lock screen truncates anyway, and a long body leaks more', () => {
    expect(safeBody('x'.repeat(500)).length).toBe(220);
    expect(safeBody('x'.repeat(500), 40).length).toBe(40);
  });

  it('scrubs and truncates together, in that order', () => {
    const out = safeBody(`result: ${'a'.repeat(40)}`);
    expect(out).not.toContain('a'.repeat(40));
    expect(out).toContain(REDACTED_HINT);
  });
});

const REDACTED_HINT = '[redacted]';
