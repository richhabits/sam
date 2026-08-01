import { describe, it, expect } from "vitest";
import { toIssue, toRepo } from "./github.ts";

// The network half needs a token and a live GitHub, so what is pinned here is the shaping —
// the part that silently produces a wrong-looking list if a field moves or a null arrives.

describe("toRepo", () => {
  it("keeps the fields SAM shows and nothing else", () => {
    expect(
      toRepo({
        name: "sam",
        full_name: "richhabits/sam",
        private: false,
        description: "Your own AI",
        pushed_at: "2026-08-01T10:00:00Z",
        language: "TypeScript",
        html_url: "https://github.com/richhabits/sam",
        stargazers_count: 900,
      }),
    ).toEqual({
      name: "sam",
      full: "richhabits/sam",
      private: false,
      description: "Your own AI",
      pushedAt: "2026-08-01T10:00:00Z",
      language: "TypeScript",
      url: "https://github.com/richhabits/sam",
    });
  });

  // A repo with no description or language is completely normal, and must render as "no
  // description" rather than the string "undefined".
  it("carries absent description and language through as null, never undefined", () => {
    const r = toRepo({ name: "x", full_name: "a/x", html_url: "u" });
    expect(r.description).toBeNull();
    expect(r.language).toBeNull();
    expect(r.private).toBe(false);
  });
});

describe("toIssue", () => {
  // GitHub returns pull requests from the issues endpoint, marked only by a `pull_request`
  // key. Losing that distinction would list every PR as an issue.
  it("marks a pull request as a PR", () => {
    expect(toIssue({ number: 7, title: "Fix it", state: "open", pull_request: { url: "…" }, html_url: "u" }).isPR).toBe(true);
    expect(toIssue({ number: 8, title: "Bug", state: "open", html_url: "u" }).isPR).toBe(false);
  });

  it("takes the repo from the payload, falling back to the one asked for", () => {
    expect(toIssue({ number: 1, repository: { full_name: "a/b" } }, "c/d").repo).toBe("a/b");
    expect(toIssue({ number: 1 }, "c/d").repo).toBe("c/d");
    expect(toIssue({ number: 1 }).repo).toBe("");
  });
});
