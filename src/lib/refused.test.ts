import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// "REFUSED IS NOT ABSENT."
//
// Four panes — Tasks, the device list, the yard's projects, the FLIP IT desk — each wrote a
// careful panel for the case where a browser is not allowed to read something. FlipItView's even
// says why it matters: "Saying 'not set up' when the rig is sitting on disk sends you looking for
// a missing install instead of a closed door."
//
// Every one of them decided by reading `r.refused` off a SUCCESSFUL response. The server never
// sends that field; it refuses with a 403 and an { error, locked } body. So all four panels were
// unreachable, and a refusal rendered as its neighbour: "no devices are paired", "no projects",
// "the yard is off", "the rig isn't set up" — four confident claims nobody had checked.
//
// It got sharper when api.ts began throwing on a non-OK response. That change is right (it is what
// stopped 47 refused actions reporting success), but it moved the refusal from a resolved value
// into the catch — and Tasks then sat on "Looking…" forever, which is worse than saying the wrong
// thing, because it never finishes saying anything.
//
// The rule this pins: a refusal is decided in the CATCH, from the typed error, never from a field
// on a success.
const dir = dirname(fileURLToPath(import.meta.url));
const srcDir = join(dir, "..");

const PANES = ["TasksView.tsx", "Dashboard.tsx", "YardView.tsx", "FlipItView.tsx"];

describe("a refusal must be told apart from an empty result", () => {
  it.each(PANES)("%s decides refusal from the error, not from a success field", (file) => {
    const src = readFileSync(join(srcDir, file), "utf8");
    // Something in the file must inspect the typed error for a refusal…
    expect(src, `${file} never checks the error for 401/403/locked`).toMatch(/\.status === 40[13]|\?\.locked/);
    // …and nothing may still read `refused` off a resolved response.
    const reads = src.split("\n").filter((l) => /\br\??\.refused|\bd\??\.refused\b/.test(l) && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"));
    const offending = reads.filter((l) => !/setD\(|d\?\.refused \?/.test(l));   // rendering the state is fine; deriving it from a success is not
    expect(offending, `${file} still derives refusal from a success response`).toEqual([]);
  });

  it("sets the refused flag only from a catch, never from a resolved value", () => {
    // The first version of this test asserted that no catch in these files may call a failure
    // "transient". That was wrong: the job-DETAIL poll genuinely is transient, and a test that
    // cannot tell one call from another produces exactly the confident-and-wrong answer this file
    // exists to prevent. What actually matters is narrower — where the refused flag is SET.
    for (const file of PANES) {
      const src = readFileSync(join(srcDir, file), "utf8").split("\n");
      src.forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, "");
        if (!/set(Devices)?Refused\(true\)|setD\(\{ refused: true/.test(code)) return;
        // …and the line that sets it must be reasoning about an error, not a response body.
        expect(code, `${file}:${i + 1} sets refused without inspecting the error`).toMatch(/status|locked/);
      });
    }
  });

  it("covers every pane that OWNS a refused state (guards the guard)", () => {
    // Keyed on declaring the state, not on mentioning the word — the prose in these files
    // discusses "refused" at length, and the first version of this check counted that too.
    const owners = readdirSync(srcDir)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /useState[^\n]*\n?[^\n]*|/.test("") && /const \[(devices)?[Rr]efused, set(Devices)?Refused\]/.test(readFileSync(join(srcDir, f), "utf8")));
    // FlipItView carries the state inside its payload (d.refused) rather than a useState, so it
    // is listed in PANES but will not appear here — assert the useState-owning subset exactly.
    expect(owners.sort()).toEqual(PANES.filter((p) => p !== "FlipItView.tsx").sort());
  });
});
