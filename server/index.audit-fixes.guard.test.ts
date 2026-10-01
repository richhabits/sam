import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// index.ts boots a server on import, so these handlers cannot be mounted in a test. Like the other
// *.guard.test.ts files, they pin the fix by reading the source: a revert fails here.
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");
const handler = (start: string, end: string) => {
  const a = src.indexOf(start);
  expect(a, `${start} not found`).toBeGreaterThan(-1);
  return src.slice(a, src.indexOf(end, a));
};

describe("GET /api/voice/token", () => {
  const body = handler('app.get("/api/voice/token"', "// ── Self-update");
  it("never relays the upstream OpenAI body (its 401 text quotes the key back)", () => {
    expect(body).not.toMatch(/await r\.text\(\)/);
    expect(body).not.toMatch(/error:\s*e\.message/);
    expect(body).toContain("upstreamStatus");
  });
});

describe("POST /api/code/repair", () => {
  const body = handler('app.post("/api/code/repair"', "// ── Guided Key Setup");
  it("does not block the event loop with execSync", () => {
    expect(body).not.toContain("execSync");
  });
  it("bounds the type-check with a timeout", () => {
    expect(body).toMatch(/timeout:\s*120_?000/);
    expect(body).toContain("maxBuffer");
  });
});

describe("the error handler", () => {
  it("is registered, and after the SPA fallback so it sees every route's errors", () => {
    expect(src).toContain("app.use(jsonErrorHandler)");
    expect(src.indexOf("app.use(jsonErrorHandler)")).toBeGreaterThan(src.indexOf('app.get("/*splat"'));
  });
});
