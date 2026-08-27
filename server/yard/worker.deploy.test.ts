// Isolated from worker.test.ts on purpose: this file mocks ./exec.ts and ./deploy.ts, and
// vi.mock is module-scoped, not test-scoped — sharing a file with the other HANDLERS tests
// would silently stub execInProject for every other job kind too (managed.ts's own real git
// checkpointing runs through the same module).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JobStore } from "./store.ts";

const { execInProject, smokeTest } = vi.hoisted(() => ({ execInProject: vi.fn(), smokeTest: vi.fn() }));
// Only the "vercel" binary is faked — createProject()/checkpoint() use this same execInProject
// for their own real git init/add/commit, and those need to actually run so isManagedProject()
// (which checks for a real .git directory) sees a real project, not a stubbed-away one.
vi.mock("./exec.ts", async (importOriginal) => {
  const real = await importOriginal<any>();
  execInProject.mockImplementation(async (dir: string, cmd: string, args: string[], opts: any) =>
    cmd === "vercel" ? { code: 0, stdout: "Production: https://hello-site.vercel.app", stderr: "" } : real.execInProject(dir, cmd, args, opts));
  return { ...real, execInProject };
});
vi.mock("./deploy.ts", async (importOriginal) => {
  const real = await importOriginal<any>();
  smokeTest.mockImplementation(async () => ({ ok: true, status: 200, detail: "live, 42 bytes" }));
  return { ...real, smokeTest };
});

import { runOneJob } from "./worker.ts";
import { createProject, readManifest, projectPath } from "./managed.ts";

// planDeploy refuses a project with nothing to publish — createProject() alone only scaffolds
// the manifest, not a real site. Every fixture project here needs something deployable, same as
// any real yard-built site would have by the time a human taps "publish".
async function createDeployableProject(name: string) {
  const m = await createProject(name);
  writeFileSync(join(projectPath(m.slug), "index.html"), "<h1>hi</h1>");
  return m;
}

let dir: string;
let store: JobStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "yard-deploy-worker-"));
  process.env.YARD_DIR = dir;
  process.env.SAMYARD_DIR = dir;
  process.env.VERCEL_TOKEN = "tok_test";
  process.env.SAM_YARD = "1";   // real git init/commit for createProject()'s own setup; only "vercel" calls are faked above
  store = new JobStore(":memory:");
  execInProject.mockClear();
  smokeTest.mockClear();
});
afterEach(() => {
  store.close();
  delete process.env.YARD_DIR;
  delete process.env.SAMYARD_DIR;
  delete process.env.VERCEL_TOKEN;
  delete process.env.SAM_YARD;
  rmSync(dir, { recursive: true, force: true });
});

describe("project.deploy — persisting the outcome", () => {
  it("writes live{url, publishedAt} to the manifest on a real, smoke-tested success", async () => {
    const m = await createDeployableProject("Hello Site");
    store.enqueue("project.deploy", { slug: m.slug });
    await runOneJob(store);

    const after = readManifest(m.slug)!;
    expect(after.live?.url).toBe("https://hello-site.vercel.app");
    expect(after.live?.publishedAt).toBeGreaterThan(0);
    expect(after.issues).toEqual([]);
  });

  it("does NOT mark the project live if the smoke test fails — a command exiting zero is not a page that loads", async () => {
    smokeTest.mockResolvedValueOnce({ ok: false, status: 500, detail: "the live URL answered 500" });
    const m = await createDeployableProject("Broken Site");
    const j = store.enqueue("project.deploy", { slug: m.slug });
    await runOneJob(store);

    expect(store.get(j.id)!.state).toBe("failed");
    const after = readManifest(m.slug)!;
    expect(after.live).toBeUndefined();
    expect(after.issues[0]).toMatch(/answered badly/);
  });
});

describe("project.unpublish", () => {
  it("refuses a project that was never published — permanent, not worth retrying", async () => {
    const m = await createDeployableProject("Never Published");
    const j = store.enqueue("project.unpublish", { slug: m.slug });
    await runOneJob(store);
    expect(store.get(j.id)!.state).toBe("failed");
    expect(execInProject.mock.calls.some((c) => c[1] === "vercel")).toBe(false);
  });

  it("removes the deployment and clears live from the manifest on success", async () => {
    const m = await createDeployableProject("Live Site");
    store.enqueue("project.deploy", { slug: m.slug });
    await runOneJob(store);
    expect(readManifest(m.slug)!.live?.url).toBe("https://hello-site.vercel.app");

    store.enqueue("project.unpublish", { slug: m.slug });
    await runOneJob(store);

    const after = readManifest(m.slug)!;
    expect(after.live).toBeUndefined();
    const rmCall = execInProject.mock.calls.find((c) => c[2]?.[0] === "rm");
    expect(rmCall).toBeDefined();
    expect(rmCall![2]).toEqual(["rm", m.slug, "--yes"]);
  });

  it("leaves the manifest live if the unpublish command itself fails", async () => {
    const m = await createDeployableProject("Stubborn Site");
    store.enqueue("project.deploy", { slug: m.slug });
    await runOneJob(store);

    execInProject.mockResolvedValueOnce({ code: 1, stdout: "", stderr: "error: not found" });
    const j = store.enqueue("project.unpublish", { slug: m.slug });
    await runOneJob(store);

    expect(store.get(j.id)!.state).toBe("failed");
    expect(readManifest(m.slug)!.live?.url).toBe("https://hello-site.vercel.app");
  });
});
