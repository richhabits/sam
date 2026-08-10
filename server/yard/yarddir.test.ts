import { afterEach, describe, expect, it } from "vitest";
import { yardDir } from "./store.ts";

// Its own file on purpose: these mutate YARD_DIR, and store.test.ts opens real databases
// through the same resolver — sharing a process meant one test's env leaked into another's
// store and took the worker down with it.

const KEEP = process.env.YARD_DIR;
afterEach(() => {
  if (KEEP === undefined) delete process.env.YARD_DIR;
  else process.env.YARD_DIR = KEEP;
});

describe("yardDir — packaging safety", () => {
  it("honours an explicit YARD_DIR above everything else", () => {
    process.env.YARD_DIR = "/tmp/sam-yard-explicit";
    expect(yardDir()).toBe("/tmp/sam-yard-explicit");
  });

  // THE BUG THIS GUARDS. In the packaged desktop build this module lives inside app.asar, a
  // read-only archive, so a module-relative default produced a path nothing could create.
  // jobs.db, paired.json, worker.lock and logs/ all sit under it, so /api/yard answered 500
  // to a correctly paired phone — and the yard only ever worked when the server ran from a
  // checkout, which is why the launchd daemon could serve it and SAM.app never could.
  it("never returns a path inside app.asar", () => {
    delete process.env.YARD_DIR;
    expect(yardDir()).not.toContain("app.asar");
  });

  it("keeps a checkout on its repo-local yard, so existing jobs do not move", () => {
    delete process.env.YARD_DIR;
    expect(yardDir().endsWith("/yard")).toBe(true);
  });
});
