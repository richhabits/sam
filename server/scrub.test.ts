import { describe, it, expect, afterEach } from "vitest";
import { scrub, scrubDeep, scrubConsole, sensitiveEnvNames, publicError, REDACTED } from "./scrub.ts";

// A secret only has to reach ONE sink to be on disk in plain text for ever. These tests
// are the guarantee that it does not — by shape for credentials SAM has never seen, and
// by reference for the ones it holds.

const restore: (() => void)[] = [];
afterEach(() => { while (restore.length) restore.pop()!(); });

describe("by shape — credentials SAM has never seen", () => {
  it("redacts the provider formats, keeping enough to say WHAT was there", () => {
    const cases: [string, string][] = [
      ["sk-abcdefghij0123456789KLMNOP", "sk-a"],
      ["gsk_abcdefghij0123456789KLMN", "gsk_"],
      ["vcp_abcdefghij0123456789KLMN", "vcp_"],
      ["AIzaSyAbcdefghij0123456789KLMNOPqrstuvwx", "AIza"],
      ["ghp_abcdefghij0123456789KLMNOPqrstuv", "ghp_"],
      ["nvapi-abcdefghij0123456789KLMN", "nvap"],
      ["csk-abcdefghij0123456789KLMN", "csk-"],
    ];
    for (const [secret, keep] of cases) {
      const out = scrub(`the key is ${secret} ok`);
      expect(out).not.toContain(secret);
      expect(out).toContain(`${keep}${REDACTED}`);
    }
  });

  it("redacts a bearer header and long hex", () => {
    expect(scrub("Authorization: Bearer abcdef0123456789abcdef0123")).toContain(`Bearer ${REDACTED}`);
    expect(scrub("session a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0")).toContain(REDACTED);
  });

  it("leaves ordinary text completely alone", () => {
    for (const plain of ["hello there", "building one-page-hello-site", "exit code 3", "sk- is a prefix"]) {
      expect(scrub(plain)).toBe(plain);
    }
  });

  it("redacts every occurrence, not just the first", () => {
    const out = scrub("gsk_aaaaaaaaaaaaaaaaaaaaaa and gsk_bbbbbbbbbbbbbbbbbbbbbb");
    expect(out).not.toMatch(/aaaaaaaaaaaaaaaaaaaaaa|bbbbbbbbbbbbbbbbbbbbbb/);
  });
});

describe("by reference — the ones SAM actually holds", () => {
  const env = { SOME_TOKEN: "not-a-recognisable-shape-at-all-9182", PLAIN: "ordinary" } as any;

  it("finds sensitive variables by NAME, so a new provider is covered without a code change", () => {
    const names = sensitiveEnvNames({ FOO_TOKEN: "x", BAR_API_KEY: "x", BAZ_KEYS: "x", QUX_SECRET: "x", NOPE: "x", MODEL: "x" } as any);
    expect(names.sort()).toEqual(["BAR_API_KEY", "BAZ_KEYS", "FOO_TOKEN", "QUX_SECRET"]);
  });

  it("redacts a credential with NO recognisable format — the case shape-matching cannot catch", () => {
    const out = scrub("connecting with not-a-recognisable-shape-at-all-9182 now", env);
    expect(out).not.toContain("not-a-recognisable-shape-at-all-9182");
    expect(out).toContain(REDACTED);
  });

  it("handles the pooled comma-list form, where one variable holds several secrets", () => {
    const pooled = { GROQ_API_KEYS: "aaaaaaaaaaaa1111,bbbbbbbbbbbb2222" } as any;
    const out = scrub("keys aaaaaaaaaaaa1111 and bbbbbbbbbbbb2222", pooled);
    expect(out).not.toContain("aaaaaaaaaaaa1111");
    expect(out).not.toContain("bbbbbbbbbbbb2222");
  });

  it("holds no secret of its own — it looks them up, never stores them", () => {
    // scrubbing with an empty environment must not redact by reference at all
    expect(scrub("not-a-recognisable-shape-at-all-9182", {} as any)).toBe("not-a-recognisable-shape-at-all-9182");
  });

  it("ignores very short values, which would turn a log into noise", () => {
    expect(scrub("the cat sat", { A_KEY: "at" } as any)).toBe("the cat sat");
  });
});

describe("structured data", () => {
  it("redacts wholesale by key name, whatever the value looks like", () => {
    const out = scrubDeep({ provider: "groq", apiKey: "anything", token: "x", nested: { password: "hunter2" } }) as any;
    expect(out.apiKey).toBe(REDACTED);
    expect(out.token).toBe(REDACTED);
    expect(out.nested.password).toBe(REDACTED);
    expect(out.provider).toBe("groq");            // ordinary values survive
  });

  it("walks arrays and stops before recursing for ever", () => {
    const out = scrubDeep({ items: ["gsk_aaaaaaaaaaaaaaaaaaaaaa", "fine"] }) as any;
    expect(out.items[0]).toContain(REDACTED);
    expect(out.items[1]).toBe("fine");
    const deep: any = {}; let cur = deep;
    for (let i = 0; i < 12; i++) { cur.next = {}; cur = cur.next; }
    expect(JSON.stringify(scrubDeep(deep))).toContain("too deep");
  });
});

describe("the console itself", () => {
  it("scrubs anything SAM prints, so a sink cannot be forgotten", () => {
    const seen: string[] = [];
    const fake = { log: (...a: any[]) => seen.push(a.join(" ")), warn: () => {}, error: () => {}, info: () => {} } as any;
    restore.push(scrubConsole(fake));
    fake.log("token vcp_abcdefghij0123456789KLMN here");
    expect(seen[0]).not.toContain("abcdefghij0123456789KLMN");
    expect(seen[0]).toContain(`vcp_${REDACTED}`);
  });

  it("puts the console back when asked", () => {
    const fake = { log: () => {}, warn: () => {}, error: () => {}, info: () => {} } as any;
    const original = fake.log;
    const undo = scrubConsole(fake);
    expect(fake.log).not.toBe(original);
    undo();
    expect(fake.log).toBe(original);
  });
});

describe("what an error may say to a caller", () => {
  it("collapses a home directory, so a message stops describing the machine", () => {
    const e = new Error("ENOENT: no such file or directory, open '/Users/romeovalentine/sam/vault/keys.json'");
    const out = publicError(e, false);
    expect(out).not.toContain("romeovalentine");
    expect(out).toContain("~/sam/vault/keys.json");   // still diagnosable
  });

  it("handles linux and windows homes too", () => {
    expect(publicError(new Error("at /home/someone/app/x.js"), false)).not.toContain("someone");
    expect(publicError(new Error("at C:\\Users\\Someone\\app"), false)).not.toContain("Someone");
  });

  it("removes a secret that found its way into an error", () => {
    const out = publicError(new Error("auth failed for gsk_abcdefghij0123456789KLMN"), false);
    expect(out).not.toContain("abcdefghij0123456789KLMN");
    expect(out).toContain(REDACTED);
  });

  it("keeps it to one bounded line in production, so a stack cannot arrive another way", () => {
    const e = new Error(`first line\n    at foo (/Users/x/a.js:1:1)\n    at bar (/Users/x/b.js:2:2)`);
    const out = publicError(e, false);
    expect(out).toBe("first line");
    expect(out).not.toContain("at foo");
    expect(publicError(new Error("z".repeat(500)), false).length).toBeLessThanOrEqual(300);
  });

  it("keeps the detail in development, where it is worth having", () => {
    const e = new Error("first line\n    at foo (/tmp/a.js:1:1)");
    expect(publicError(e, true)).toContain("at foo");
  });

  it("never throws on odd input", () => {
    for (const bad of [null, undefined, 42, {}, [], new Error("")]) {
      expect(typeof publicError(bad as any, false)).toBe("string");
    }
  });
});
