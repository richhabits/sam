import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerWebhookEndpoint } from "./webhooks.ts";

// Audit finding: webhooks.json holds each endpoint's HMAC signing secret and was written with a
// plain writeFileSync — default umask (0644, readable by other users) and truncate-in-place.

describe("webhooks.json at rest", () => {
  let dir: string;
  let prev: string | undefined;
  beforeAll(() => { prev = process.env.VAULT_DIR; dir = mkdtempSync(join(tmpdir(), "sam-whk-")); process.env.VAULT_DIR = dir; });
  afterAll(() => { if (prev === undefined) delete process.env.VAULT_DIR; else process.env.VAULT_DIR = prev; rmSync(dir, { recursive: true, force: true }); });

  it("is written 0600", () => {
    registerWebhookEndpoint("t", "https://example.com/hook", ["*"]);
    expect(statSync(join(dir, "webhooks.json")).mode & 0o777).toBe(0o600);
  });
});
