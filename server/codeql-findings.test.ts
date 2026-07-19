import { describe, expect, it } from "vitest";
import { addUrl } from "./notebook.ts";
import { deleteWorkflow, getWorkflow, isValidWorkflowId, saveWorkflow } from "./workflows.ts";

// Regression tests for the two CodeQL findings that were REAL, so they can't quietly come back.
// GitHub's scanner closes an alert when the pattern disappears — it does not stop the pattern
// being reintroduced later. A test does.

describe("notebook addUrl — CodeQL #84, Critical SSRF", () => {
  // SAM runs INSIDE the user's network. An unguarded fetch here reaches the router, a NAS, or
  // SAM's own API on localhost — none of which are reachable from the internet. The URL can come
  // from the user OR from a page SAM already read, which is the indirect-injection path.
  it("refuses loopback, LAN and link-local targets", async () => {
    for (const url of [
      "http://127.0.0.1:8787/api/admin/config",
      "http://192.168.1.1/admin",
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:8787/api/keys",
    ]) {
      await expect(addUrl("nb", url), url).rejects.toThrow(/blocked/i);
    }
  });

  it("refuses non-http schemes", async () => {
    await expect(addUrl("nb", "file:///etc/passwd")).rejects.toThrow(/blocked/i);
  });
});

describe("workflow ids — CodeQL #93/#94/#95, path-expression injection", () => {
  // An id becomes a FILENAME and arrives raw from req.params.id. Unvalidated,
  // join(DIR, id + ".json") escapes the vault. NAME_RE guarded the display name, a different field.
  const TRAVERSALS = [
    "../../etc/passwd",
    "..%2f..%2fetc%2fpasswd",
    "../../../.env",
    "foo/../../bar",
    "/etc/passwd",
    "..\\..\\windows\\system32",
  ];

  it("rejects every traversal shape", () => {
    for (const id of TRAVERSALS) expect(isValidWorkflowId(id), id).toBe(false);
  });

  it("reads and deletes fail closed rather than escaping the vault", () => {
    for (const id of TRAVERSALS) {
      expect(getWorkflow(id), id).toBeNull();
      expect(deleteWorkflow(id), id).toBe(false);
    }
  });

  it("save refuses a bad id with a reason instead of writing somewhere odd", () => {
    const r = saveWorkflow({ id: "../../pwned", name: "ok name", steps: [{ tool: "noop" }] } as never);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/id/i);
  });

  it("still accepts the ids real workflows use", () => {
    for (const id of ["daily-brief", "inbox_triage", "a", "Weekly-Report-2026"]) {
      expect(isValidWorkflowId(id), id).toBe(true);
    }
  });
});
