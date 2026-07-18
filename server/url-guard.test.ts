import { describe, expect, it } from "vitest";
import { checkOutboundUrl, isPrivateAddress } from "./url-guard.ts";

// Hermetic resolver — no real DNS, so these tests pass offline and never flake in CI.
const resolves = (map: Record<string, string[]>) => async (host: string) => {
  const a = map[host];
  if (!a) throw new Error(`no record for ${host}`);
  return a;
};
const publicDns = resolves({ "en.wikipedia.org": ["185.15.59.224"], "evil.com": ["127.0.0.1"] });

// SAM is local-first: it runs inside the user's LAN, so a URL it fetches on someone else's say-so
// can reach things the internet cannot — the router admin page, a NAS, a printer, SAM's own API.

describe("isPrivateAddress", () => {
  it("catches every range that must never be fetched", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3", // the rest of 127/8 — unlike isLoopback, here the whole block must be caught
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1", // the router
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "::ffff:127.0.0.1", // IPv4-mapped loopback, dotted
      "::ffff:7f00:1", // the SAME address in hex — the spelling a blocklist forgets
      "::ffff:c0a8:101", // 192.168.1.1 in hex
      "::ffff:192.168.1.1",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it("does not over-block public addresses", () => {
    // A guard that blocks everything is safe and useless. These must stay fetchable.
    for (const ip of [
      "8.8.8.8",
      "1.1.1.1",
      "172.15.0.1", // just below the 172.16/12 block
      "172.32.0.1", // just above it
      "192.169.1.1", // near-miss on 192.168
      "100.63.0.1", // just below CGNAT
      "128.0.0.1",
      "2606:4700::1111",
    ]) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });
});

describe("checkOutboundUrl", () => {
  it("refuses non-web schemes", async () => {
    // file: would quietly turn a web-reading tool into an arbitrary local-file reader.
    for (const u of ["file:///etc/passwd", "data:text/html,<b>x", "gopher://x", "ftp://x/y"]) {
      const v = await checkOutboundUrl(u, publicDns);
      expect(v.ok, u).toBe(false);
    }
  });

  it("refuses loopback and LAN targets by literal address", async () => {
    for (const u of [
      "http://127.0.0.1:8787/api/admin/config", // SAM's own API
      "http://192.168.1.1/admin", // the router
      "http://[::1]:8787/api/keys",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:8787/api/keys",
      "http://nas.local/files",
      "http://wiki.internal/",
    ]) {
      const v = await checkOutboundUrl(u, publicDns);
      expect(v.ok, u).toBe(false);
    }
  });

  it("fails closed when a host cannot be resolved at all", async () => {
    const v = await checkOutboundUrl("http://nowhere.example/", publicDns);
    expect(v.ok).toBe(false); // unknown is refused, not allowed through
  });

  it("refuses a public NAME that resolves to a private address", async () => {
    // The bypass a literal-IP blocklist misses entirely: an attacker points evil.com at
    // 127.0.0.1 and the URL looks perfectly ordinary.
    const v = await checkOutboundUrl("http://evil.com/api/admin/keys", publicDns);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/resolves to private/);
  });

  it("rejects malformed input rather than throwing", async () => {
    for (const u of ["", "not a url", "http://", "://x"]) {
      const v = await checkOutboundUrl(u, publicDns);
      expect(v.ok, u).toBe(false);
    }
  });

  it("still allows ordinary public URLs", async () => {
    // The whole point. If this test is ever the one that fails, the guard has become a wall.
    const v = await checkOutboundUrl("https://en.wikipedia.org/wiki/Ada_Lovelace", publicDns);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.url.hostname).toBe("en.wikipedia.org");
  });
});
