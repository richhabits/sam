import { describe, expect, it } from 'vitest';
import { parsePairLink } from './pairlink.ts';

// A pairing link is an authentication on-ramp, so the parser is the thing standing between
// "tapped a link" and "sent a credential somewhere". These tests pin both halves: it accepts
// the two shapes SAM actually produces, and it refuses everything else rather than shrugging
// and putting whatever it found on the wire.

const CODE = '78736a8389fc6172fa17425ae40e908f';

describe('parsePairLink — the shapes SAM mints', () => {
  it('reads the browser link the server already prints, host and all', () => {
    expect(parsePairLink(`http://127.0.0.1:8787/pair?code=${CODE}`)).toEqual({
      code: CODE,
      host: 'http://127.0.0.1:8787',
    });
  });

  it('reads a LAN / tailscale address the same way — the host comes from the link, not retyped', () => {
    expect(parsePairLink(`http://100.83.12.4:8787/pair?code=${CODE}`)).toEqual({
      code: CODE,
      host: 'http://100.83.12.4:8787',
    });
    expect(parsePairLink(`https://sam.example.com/pair?code=${CODE}`)?.host).toBe(
      'https://sam.example.com',
    );
  });

  it('reads our own scheme, with an explicit host', () => {
    expect(parsePairLink(`sam://pair?code=${CODE}&host=http%3A%2F%2F192.168.0.9%3A8787`)).toEqual({
      code: CODE,
      host: 'http://192.168.0.9:8787',
    });
  });

  it('accepts our scheme with no host — the app falls back to the one it already knows', () => {
    expect(parsePairLink(`sam://pair?code=${CODE}`)).toEqual({ code: CODE, host: null });
  });

  it('ignores a trailing slash and is case-insensitive on the scheme', () => {
    expect(parsePairLink(`HTTP://127.0.0.1:8787/pair/?code=${CODE}`)?.code).toBe(CODE);
  });
});

describe('parsePairLink — what it refuses', () => {
  it('refuses a URL that is not a pairing link, however tempting the query looks', () => {
    expect(parsePairLink(`http://127.0.0.1:8787/api/chat?code=${CODE}`)).toBeNull();
    expect(parsePairLink(`sam://open?code=${CODE}`)).toBeNull();
    expect(parsePairLink(`http://evil.example.com/pairing?code=${CODE}`)).toBeNull();
  });

  it('refuses anything that is not code-shaped — this value goes straight onto the wire', () => {
    for (const bad of ['', 'abc', 'not-hex-at-all-not-hex-at-all', 'z'.repeat(32), '../../etc/passwd']) {
      expect(parsePairLink(`sam://pair?code=${encodeURIComponent(bad)}`), bad).toBeNull();
    }
  });

  it('refuses a code padded past the bound rather than truncating it', () => {
    expect(parsePairLink(`sam://pair?code=${'a'.repeat(65)}`)).toBeNull();
  });

  it('drops a malformed host instead of talking to it', () => {
    expect(parsePairLink(`sam://pair?code=${CODE}&host=javascript%3Aalert(1)`)?.host).toBeNull();
    expect(parsePairLink(`sam://pair?code=${CODE}&host=notaurl`)?.host).toBeNull();
    // A path on the host would change WHICH endpoint gets the token — refuse, don't sanitise.
    expect(parsePairLink(`sam://pair?code=${CODE}&host=http%3A%2F%2Fevil%2F%40real`)?.host).toBeNull();
  });

  it('survives junk without throwing', () => {
    for (const junk of [null, undefined, '', '?', 'sam://pair?', '%%%', 'sam://pair?code']) {
      expect(() => parsePairLink(junk as string)).not.toThrow();
      expect(parsePairLink(junk as string)).toBeNull();
    }
  });
});
