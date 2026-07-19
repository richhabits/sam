import { describe, expect, it } from "vitest";
import { addUrl } from "./notebook.ts";
import { esc } from "./tools.ts";
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

describe("AppleScript escaping — CodeQL incomplete-sanitization on tools.ts", () => {
  // Nine tool sites (Notes, Mail, Contacts, wallpaper) built AppleScript by interpolating user
  // text into a double-quoted literal, escaping the QUOTE but not the BACKSLASH. A note title
  // ending in "\" then escapes the closing quote and breaks out of the string — arbitrary
  // AppleScript, which reaches `do shell script`. esc() is the one correct escaper they now share.
  it("escapes the backslash before the quote, not the other way round", () => {
    // If quote were escaped first, a lone trailing backslash would survive unescaped.
    expect(esc('a\\')).toBe("a\\\\");
    expect(esc('"')).toBe('\\"');
  });

  it("neutralises the break-out payloads", () => {
    // Each of these, interpolated as `"${esc(x)}"`, must stay one inert string literal.
    for (const attack of ['x\\" & (system attribute "USER") & "', 'end\\', '"; do shell script "id']) {
      const embedded = `"${esc(attack)}"`;
      // No unescaped quote can appear mid-literal: strip the escaped pairs and the wrapping quotes,
      // and nothing that could close the string early may remain.
      const inner = embedded.slice(1, -1).replace(/\\\\/g, "").replace(/\\"/g, "");
      expect(inner.includes('"'), attack).toBe(false);
    }
  });
});
