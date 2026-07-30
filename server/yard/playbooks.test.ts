import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractParams, renderTemplate, listPlaybooks, getPlaybook, savePlaybook,
  deletePlaybook, importMarkdown,
} from "./playbooks.ts";

// The promise this file makes: a saved playbook survives, a run always uses the template
// that was actually saved (not silently drifted), and provenance (which version ran)
// stays legible even after the template has since changed.

let base: string;
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "samyard-playbooks-"));
  process.env.SAMYARD_DIR = base;
});
afterEach(() => {
  delete process.env.SAMYARD_DIR;
  rmSync(base, { recursive: true, force: true });
});

describe("extractParams / renderTemplate", () => {
  it("finds every {{placeholder}}, deduplicated", () => {
    expect(extractParams("build {{project}} on {{branch}}, deploy to {{target}}")).toEqual(["project", "branch", "target"]);
    expect(extractParams("{{x}} and {{x}} again")).toEqual(["x"]);
    expect(extractParams("no placeholders here")).toEqual([]);
  });

  it("fills what it has and leaves the rest as the literal placeholder", () => {
    const out = renderTemplate("deploy {{project}} to {{target}}", { project: "hectic-radio" });
    expect(out).toBe("deploy hectic-radio to {{target}}");
  });

  it("ignores blank/whitespace-only values — same as not supplying them", () => {
    const out = renderTemplate("hello {{name}}", { name: "   " });
    expect(out).toBe("hello {{name}}");
  });
});

describe("saving and versioning", () => {
  it("a new playbook starts at version 1", () => {
    const pb = savePlaybook({ name: "Ship it", template: "ship {{project}}" });
    expect(pb.version).toBe(1);
    expect(pb.params).toEqual(["project"]);
  });

  it("editing the template bumps the version; editing just values does not", () => {
    const pb = savePlaybook({ name: "Ship it", template: "ship {{project}}" });
    const sameTemplate = savePlaybook({ id: pb.id, name: pb.name, template: pb.template, lastValues: { project: "sam" } });
    expect(sameTemplate.version).toBe(1);
    expect(sameTemplate.lastValues).toEqual({ project: "sam" });

    const changedTemplate = savePlaybook({ id: pb.id, name: pb.name, template: "ship {{project}} to {{target}}" });
    expect(changedTemplate.version).toBe(2);
    expect(changedTemplate.params).toEqual(["project", "target"]);
  });

  it("round-trips through listPlaybooks and getPlaybook", () => {
    const a = savePlaybook({ name: "A", template: "do a thing" });
    const b = savePlaybook({ name: "B", template: "do another thing" });
    const listed = listPlaybooks();
    expect(listed.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    expect(getPlaybook(a.id)?.name).toBe("A");
    expect(getPlaybook("no-such-id")).toBeNull();
  });

  it("deletes cleanly, and a missing id is reported honestly, not thrown", () => {
    const pb = savePlaybook({ name: "Gone soon", template: "x" });
    expect(deletePlaybook(pb.id)).toBe(true);
    expect(getPlaybook(pb.id)).toBeNull();
    expect(deletePlaybook("never-existed")).toBe(false);
  });

  it("rejects an id shaped like a path escape rather than resolving it", () => {
    // playbooksDir() is fixed; filePath() only ever joins a validated id onto it — this
    // proves the validation actually holds, not just that the happy path works.
    expect(getPlaybook("../../etc/passwd")).toBeNull();
    expect(deletePlaybook("../../etc/passwd")).toBe(false);
  });
});

describe("importing a dropped .md", () => {
  it("a leading '# Title' line becomes the name; the rest becomes the template", () => {
    const pb = importMarkdown("# Launch checklist\n\nDo the thing for {{project}}.", "whatever.md");
    expect(pb.name).toBe("Launch checklist");
    expect(pb.template).toBe("Do the thing for {{project}}.");
    expect(pb.params).toEqual(["project"]);
  });

  it("falls back to the filename when there's no title line", () => {
    const pb = importMarkdown("just some text, no heading", "my-brief.md");
    expect(pb.name).toBe("my-brief");
    expect(pb.template).toBe("just some text, no heading");
  });

  it("falls back to a generic name when there's neither a title nor a filename", () => {
    const pb = importMarkdown("no heading, no filename");
    expect(pb.name).toBe("Imported playbook");
  });
});
