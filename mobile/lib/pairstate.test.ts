import { describe, expect, it } from "vitest";
import { normalizeHost, pairedDespiteError } from "./pairstate";

// The situation these pin down, from a real device: the phone scanned the QR, paired, sent its
// "This phone is paired" notification — and showed the pairing form with "That code was already
// used or has expired" in red. Both halves were true. The first claim paired it; iOS delivered
// the launch link a second time; the second claim of a single-use code was refused; and the
// refusal was rendered as though the pairing had failed.

describe("normalizeHost", () => {
  it("strips trailing slashes and surrounding space", () => {
    expect(normalizeHost("  http://172.20.10.3:8787/  ")).toBe("http://172.20.10.3:8787");
    expect(normalizeHost("http://172.20.10.3:8787///")).toBe("http://172.20.10.3:8787");
  });

  it("leaves an already-clean host alone", () => {
    expect(normalizeHost("http://172.20.10.3:8787")).toBe("http://172.20.10.3:8787");
  });

  it("does not invent a scheme or a port", () => {
    // Whatever pairing stored is what later calls must hit; quietly "helping" here would point
    // the phone at a different URL than the one it paired with.
    expect(normalizeHost("172.20.10.3")).toBe("172.20.10.3");
  });
});

describe("pairedDespiteError — is a failed claim actually a success?", () => {
  const HOST = "http://172.20.10.3:8787";

  it("says paired when a token for this host is already stored", () => {
    // The reported bug: claim #2 refused, claim #1 already stored a working token.
    expect(pairedDespiteError({ targetHost: HOST, storedHost: HOST, storedToken: "tok" })).toBe(true);
  });

  it("ignores a trailing slash between the stored and target host", () => {
    // The link's host and the typed host reach this from different places; a slash is not a
    // different machine, and calling it one would show a real pairing as a failure.
    expect(pairedDespiteError({ targetHost: `${HOST}/`, storedHost: HOST, storedToken: "tok" })).toBe(true);
    expect(pairedDespiteError({ targetHost: HOST, storedHost: `${HOST}/`, storedToken: "tok" })).toBe(true);
  });

  it("refuses to wave through a token belonging to a DIFFERENT Mac", () => {
    // The dangerous direction. A phone re-pairing to a new machine still holds the old one's
    // token; treating that as success gives a phone that looks paired and authenticates
    // against nothing — a silent failure, and worse than the red error it replaced.
    expect(pairedDespiteError({ targetHost: HOST, storedHost: "http://192.168.1.50:8787", storedToken: "old" })).toBe(false);
  });

  it("refuses when the port differs, same address", () => {
    // Two SAMs on one machine are two SAMs.
    expect(pairedDespiteError({ targetHost: HOST, storedHost: "http://172.20.10.3:8799", storedToken: "tok" })).toBe(false);
  });

  it("refuses when there is no token", () => {
    // A genuinely expired code with nothing stored — the error is the truth, show it.
    expect(pairedDespiteError({ targetHost: HOST, storedHost: HOST, storedToken: null })).toBe(false);
    expect(pairedDespiteError({ targetHost: HOST, storedHost: HOST, storedToken: "" })).toBe(false);
  });

  it("refuses when a token exists but no host was recorded", () => {
    // Cannot show it is a pairing with THIS machine, so it does not count as one.
    expect(pairedDespiteError({ targetHost: HOST, storedHost: null, storedToken: "tok" })).toBe(false);
    expect(pairedDespiteError({ targetHost: HOST, storedHost: undefined, storedToken: "tok" })).toBe(false);
  });
});
