import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// APPLESCRIPT THAT NEVER COMPILED.
//
// read_emails and read_notes shipped with constructs AppleScript does not have. Both raised a
// SYNTAX error on every call since the day they were written, and both were wrapped in a catch
// that turned it into "Couldn't read Mail: …" / "Couldn't read Notes: …" — which reads like a
// missing permission. Nobody was ever going to debug a permissions message by opening the parser.
//
// TypeScript cannot type-check a string, and CI runs on Linux where osacompile does not exist, so
// the only thing that can hold this line is a source check. These are the two constructs that were
// actually wrong, verified against the real compiler on macOS before being written down:
//
//   `(if X then A else B)`          AppleScript has no inline conditional. `if` is a STATEMENT.
//                                   → "Expected expression, “)”, etc. but found “if”. (-2741)"
//   `sort notes by modification …`  Notes has no `sort` command; it stops on the plural class name.
//                                   → "Expected end of line, etc. but found plural class name."
const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "tools.ts"), "utf8");

// Only look inside the AppleScript template literals — osa(`…`) — so ordinary TypeScript ternaries
// and the word "sort" in JS are not mistaken for the AppleScript forms.
const scripts = [...src.matchAll(/\bosa\(`([\s\S]*?)`\)/g)].map((m) => m[1]);

describe("AppleScript source must be syntactically possible", () => {
  it("finds the AppleScript blocks to check (guards the guard)", () => {
    expect(scripts.length).toBeGreaterThan(5);
  });

  it("never uses `if` as an expression — AppleScript has no inline conditional", () => {
    for (const s of scripts) {
      // An `if` appearing after an opening paren, rather than at the start of a statement.
      expect(s, s.slice(0, 90)).not.toMatch(/\(\s*if\b[^)]*\bthen\b[^)]*\belse\b/);
    }
  });

  it("never calls `sort` on a plural class — no AppleScript app dictionary here has it", () => {
    for (const s of scripts) {
      expect(s, s.slice(0, 90)).not.toMatch(/\bsort\s+(notes|messages|reminders|events|people|files)\b/i);
    }
  });

  it("truncates with the statement form, which is the only one that compiles", () => {
    // The shape that replaced the broken expression. If a future edit reaches for the inline
    // conditional again, the test above catches it — this one documents what to write instead.
    const truncations = scripts.filter((s) => /text 1 thru/.test(s));
    expect(truncations.length).toBeGreaterThan(0);
    for (const s of truncations) expect(s).toMatch(/if length of \w+ > \d+ then set \w+ to text 1 thru \d+ of \w+/);
  });
});
