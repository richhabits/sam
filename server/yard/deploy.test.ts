import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planDeploy, readShape, urlFrom, smokeTest, deployToken } from "./deploy.ts";

// Deploying is the one thing the yard does that the outside world can see, so these
// tests are mostly about refusing rather than shipping.

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "yard-deploy-")); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const TOKEN = "tok_test";

describe("working out what the project is", () => {
  it("calls a bare folder of files static", () => {
    writeFileSync(join(dir, "index.html"), "<h1>hi</h1>");
    const s = readShape(dir);
    expect(s.kind).toBe("static");
    expect(s.buildCommand).toBeNull();
  });

  it("calls a package with a build script built, and names the output it can see", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { build: "vite build" } }));
    mkdirSync(join(dir, "dist"));
    const s = readShape(dir);
    expect(s.kind).toBe("built");
    expect(s.buildCommand).toEqual(["npm", "run", "build"]);
    expect(s.outputDir).toBe("dist");
  });

  it("does not claim an output directory that does not exist yet", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { build: "vite build" } }));
    const s = readShape(dir);
    expect(s.outputDir).toBeNull();
    expect(s.reason).toMatch(/not created yet/);
  });

  it("treats a package with no build script as static", () => {
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "x" }));
    expect(readShape(dir).kind).toBe("static");
  });

  it("falls back to static rather than throwing on an unreadable package.json", () => {
    writeFileSync(join(dir, "package.json"), "{ not json");
    expect(readShape(dir).kind).toBe("static");
  });
});

describe("refusing to deploy", () => {
  it("refuses without a token, and says how to get one", () => {
    writeFileSync(join(dir, "index.html"), "<h1>hi</h1>");
    const r = planDeploy(dir, { token: null });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toMatch(/no VERCEL_TOKEN/);
      expect(r.reason).toMatch(/vercel\.com\/account\/tokens/);
      expect(r.reason).toMatch(/deploy jobs only/);
    }
  });

  it("refuses a project with nothing to publish", () => {
    const r = planDeploy(dir, { token: TOKEN });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/nothing to publish/);
  });

  it("refuses a project that is not there", () => {
    const r = planDeploy(join(dir, "missing"), { token: TOKEN });
    expect(r.ok).toBe(false);
  });
});

describe("the plan it makes", () => {
  beforeEach(() => writeFileSync(join(dir, "index.html"), "<h1>hi</h1>"));

  it("never puts the token on the command line", () => {
    const r = planDeploy(dir, { token: TOKEN });
    expect(r.ok).toBe(true);
    if (r.ok) {
      // anything in argv is visible to every process that can run `ps`
      expect(r.args.join(" ")).not.toContain(TOKEN);
      expect(r.env.VERCEL_TOKEN).toBe(TOKEN);
    }
  });

  it("never waits on a prompt inside a job nobody is watching", () => {
    const r = planDeploy(dir, { token: TOKEN });
    if (r.ok) expect(r.args).toContain("--yes");
  });

  it("goes to production unless told otherwise", () => {
    const prod = planDeploy(dir, { token: TOKEN });
    if (prod.ok) expect(prod.args).toContain("--prod");
    const preview = planDeploy(dir, { token: TOKEN, production: false });
    if (preview.ok) expect(preview.args).not.toContain("--prod");
  });

  it("reads the token from the environment when not handed one", () => {
    process.env.VERCEL_TOKEN = "from_env";
    try { expect(deployToken()).toBe("from_env"); } finally { delete process.env.VERCEL_TOKEN; }
  });
});

describe("finding the URL", () => {
  it("takes the last URL the deploy named", () => {
    const out = "Inspect: https://vercel.com/x\nPreview: https://hello-abc123.vercel.app\nProduction: https://hello-site.vercel.app";
    expect(urlFrom(out)).toBe("https://hello-site.vercel.app");
  });

  it("finds nothing rather than inventing one", () => {
    expect(urlFrom("Error: something went wrong")).toBeNull();
    expect(urlFrom("")).toBeNull();
  });
});

describe("checking it is really live", () => {
  const res = (status: number, body: string) => ({ status, text: async () => body }) as any;

  it("passes when the page is there", async () => {
    const r = await smokeTest("https://x.vercel.app", (async () => res(200, "<h1>hi</h1>")) as any);
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
  });

  it("fails on a bad status", async () => {
    const r = await smokeTest("https://x.vercel.app", (async () => res(404, "")) as any);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/answered 404/);
  });

  // 200 is not the same as working.
  it("fails on an empty page even though it answered 200", async () => {
    const r = await smokeTest("https://x.vercel.app", (async () => res(200, "   ")) as any);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/empty/);
  });

  it("fails rather than throwing when it cannot reach the URL", async () => {
    const r = await smokeTest("https://x.vercel.app", (async () => { throw new Error("getaddrinfo ENOTFOUND"); }) as any);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/could not reach/);
  });
});
