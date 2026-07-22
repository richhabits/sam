import { describe, expect, it } from "vitest";
import { checkOutboundUrl, isPrivateAddress, safeFetch, BlockedFetch } from "./url-guard.ts";

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

  it("returns the validated IP as the pin address — the resolved one for a name", async () => {
    // safeFetch pins the connection to this exact IP, so the socket cannot re-resolve to a
    // different (private) address. For a name it must be the resolved address, not the name.
    const v = await checkOutboundUrl("https://en.wikipedia.org/wiki/Ada_Lovelace", publicDns);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.address).toBe("185.15.59.224");
  });

  it("returns a literal IP host as its own pin address", async () => {
    const v = await checkOutboundUrl("http://93.184.216.34/x", publicDns);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.address).toBe("93.184.216.34");
  });
});

describe("safeFetch — the guard survives redirects", () => {
  // A fake fetch that returns one scripted response per URL. `redirect:"manual"` means safeFetch
  // sees the 3xx itself, so we model a redirect as a 302 carrying a Location header.
  const fakeFetch = (script: Record<string, { status: number; location?: string }>) =>
    (async (input: any) => {
      const url = String(input);
      const r = script[url];
      if (!r) throw new Error(`unscripted URL in test: ${url}`);
      return { status: r.status, headers: { get: (h: string) => (h.toLowerCase() === "location" ? r.location ?? null : null) } } as any;
    }) as unknown as typeof fetch;

  it("follows a redirect to another public host and returns it", async () => {
    const dns = resolves({ "a.example": ["93.184.216.34"], "b.example": ["93.184.216.35"] });
    const fetchImpl = fakeFetch({
      "http://a.example/": { status: 302, location: "http://b.example/" },
      "http://b.example/": { status: 200 },
    });
    const res = await safeFetch("http://a.example/", {}, { resolve: dns, fetchImpl });
    expect(res.status).toBe(200);
  });

  it("BLOCKS a public URL that redirects to a private address", async () => {
    // The exact SSRF: hop 0 is public and passes; hop 1 is 127.0.0.1 and must be refused.
    const dns = resolves({ "a.example": ["93.184.216.34"] });
    const fetchImpl = fakeFetch({
      "http://a.example/": { status: 302, location: "http://127.0.0.1/admin" },
    });
    await expect(safeFetch("http://a.example/", {}, { resolve: dns, fetchImpl }))
      .rejects.toBeInstanceOf(BlockedFetch);
  });

  it("BLOCKS a redirect to cloud-metadata (169.254.169.254)", async () => {
    const dns = resolves({ "a.example": ["93.184.216.34"] });
    const fetchImpl = fakeFetch({
      "http://a.example/": { status: 302, location: "http://169.254.169.254/latest/meta-data/" },
    });
    await expect(safeFetch("http://a.example/", {}, { resolve: dns, fetchImpl }))
      .rejects.toBeInstanceOf(BlockedFetch);
  });

  it("blocks a redirect to a public NAME that resolves private", async () => {
    const dns = resolves({ "a.example": ["93.184.216.34"], "evil.com": ["127.0.0.1"] });
    const fetchImpl = fakeFetch({
      "http://a.example/": { status: 302, location: "http://evil.com/" },
    });
    await expect(safeFetch("http://a.example/", {}, { resolve: dns, fetchImpl }))
      .rejects.toBeInstanceOf(BlockedFetch);
  });

  it("refuses an endless redirect loop rather than hanging", async () => {
    const dns = resolves({ "a.example": ["93.184.216.34"] });
    const fetchImpl = fakeFetch({ "http://a.example/": { status: 302, location: "http://a.example/" } });
    await expect(safeFetch("http://a.example/", {}, { resolve: dns, fetchImpl, maxHops: 3 }))
      .rejects.toThrow(/too many redirects/);
  });
});
