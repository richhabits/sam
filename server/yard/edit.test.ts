import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The model's proposal is stubbed so the DECISIONS around it can be tested without a
// brain: what is shown to it, what is accepted back, and what happens when it returns
// something unusable. The live drive proved it works with a real model; this proves it
// stays safe when the model misbehaves.
const proposal = { text: "", provider: "stub", tier: "local" as const };
vi.mock("../models.ts", () => ({ runModel: async () => proposal }));

import { HANDLERS } from "./worker.ts";
import { createProject, readManifest, projectPath, checkpoints } from "./managed.ts";

let base: string;

beforeEach(async () => {
  base = mkdtempSync(join(tmpdir(), "samyard-edit-"));
  process.env.SAMYARD_DIR = base;
  await createProject("Hello Site", { spec: "a page", handshake: true });
  writeFileSync(join(projectPath("hello-site"), "index.html"), "<h1>before</h1>");
});
afterEach(() => {
  delete process.env.SAMYARD_DIR;
  rmSync(base, { recursive: true, force: true });
});

// The executor only runs when the yard is switched on, so it is switched on here for the
// duration. Who may CREATE a job is enforced at the route, and covered in exec.test.ts.
function withHandshake<T>(fn: () => Promise<T>): Promise<T> {
  process.env.SAM_YARD = "1";
  return fn().finally(() => { delete process.env.SAM_YARD; });
}

const ctx = (payload: any) => ({
  id: "job_test", payload, project: null,
  log: () => { /* the log is exercised in worker.test.ts */ },
  spend: () => { /* the meter is exercised in store.test.ts */ },
  checkStop: () => { /* stopping is exercised in worker.test.ts */ },
});

describe("editing a project", () => {
  it("applies a well-formed proposal and checkpoints it", async () => {
    proposal.text = JSON.stringify({ files: [{ path: "index.html", content: "<h1>after</h1>" }], note: "changed the heading" });
    const out = await withHandshake(() => HANDLERS["project.edit"](ctx({ slug: "hello-site", what: "change the heading" }) as any));
    expect(readFileSync(join(projectPath("hello-site"), "index.html"), "utf8")).toBe("<h1>after</h1>");
    expect(String(out)).toMatch(/edited 1 file/);
    const history = await checkpoints("hello-site", 10, { handshake: true });
    expect(history[0].message).toBe("change the heading");
  });

  it("checkpoints BEFORE it changes anything, so the way back always exists", async () => {
    proposal.text = JSON.stringify({ files: [{ path: "index.html", content: "<h1>after</h1>" }] });
    await withHandshake(() => HANDLERS["project.edit"](ctx({ slug: "hello-site", what: "change it" }) as any));
    const history = await checkpoints("hello-site", 10, { handshake: true });
    // newest first: the edit, then the safety net taken before it, then the scaffold
    expect(history[0].message).toBe("change it");
    expect(history[1].message).toMatch(/^before: change it/);
  });

  // The bug the first live drive produced.
  it("refuses to let the model rewrite SAM's own record of the project", async () => {
    const before = readManifest("hello-site")!;
    proposal.text = JSON.stringify({
      files: [
        { path: "index.html", content: "<h1>after</h1>" },
        { path: "project.sam.json", content: JSON.stringify({ slug: "renamed", name: "Renamed", createdAt: 0 }) },
      ],
    });
    await withHandshake(() => HANDLERS["project.edit"](ctx({ slug: "hello-site", what: "rename everything" }) as any));

    const after = readManifest("hello-site")!;
    expect(after.slug).toBe("hello-site");          // the folder is still hello-site
    expect(after.slug).toBe(before.slug);
    expect(after.createdAt).toBe(before.createdAt);
    // the legitimate part of the proposal still landed
    expect(readFileSync(join(projectPath("hello-site"), "index.html"), "utf8")).toBe("<h1>after</h1>");
  });

  it("fails without writing anything when the proposal is not JSON", async () => {
    proposal.text = "Sure! I'd be happy to help you with that.";
    await expect(withHandshake(() => HANDLERS["project.edit"](ctx({ slug: "hello-site", what: "x" }) as any)))
      .rejects.toThrow(/not valid JSON/);
    expect(readFileSync(join(projectPath("hello-site"), "index.html"), "utf8")).toBe("<h1>before</h1>");
  });

  it("fails when the proposal changes nothing the request implicated", async () => {
    proposal.text = JSON.stringify({ files: [{ path: "project.sam.json", content: "{}" }] });
    await expect(withHandshake(() => HANDLERS["project.edit"](ctx({ slug: "hello-site", what: "x" }) as any)))
      .rejects.toThrow(/changed nothing this request implicated/);
  });

  it("refuses a proposal that tries to write outside the project", async () => {
    proposal.text = JSON.stringify({ files: [{ path: "../escaped.txt", content: "pwned" }] });
    await expect(withHandshake(() => HANDLERS["project.edit"](ctx({ slug: "hello-site", what: "x" }) as any)))
      .rejects.toThrow(/outside the project/);
    expect(existsSync(join(base, "projects", "escaped.txt"))).toBe(false);
  });

  it("refuses to edit something that is not a managed project", async () => {
    proposal.text = JSON.stringify({ files: [] });
    await expect(withHandshake(() => HANDLERS["project.edit"](ctx({ slug: "nope", what: "x" }) as any)))
      .rejects.toThrow(/not a managed project/);
  });

  it("refuses an edit that does not say what to change", async () => {
    await expect(withHandshake(() => HANDLERS["project.edit"](ctx({ slug: "hello-site", what: "" }) as any)))
      .rejects.toThrow(/what to change/);
  });
});
