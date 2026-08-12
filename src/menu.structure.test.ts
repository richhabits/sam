// Menus rot in a specific way: a tab called "More" or "Data" accepts anything, so the next
// feature gets dropped in rather than filed, and eventually nobody can find what they own.
// SAM had both at once — "More" held the API keys, the phone and switching person, and "Data"
// held Workflows, Notebooks, Standing Crew, Alarms, Cameras, Live usage and Connected.
//
// These are source-text assertions, which is the honest tool for the job: what is being checked
// is that a label says what is behind it, and a rendering test cannot tell you that a word is
// the wrong word.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const app = readFileSync(join(import.meta.dirname, "App.tsx"), "utf8");

/** The JSX for one settings tab — from its own guard up to the next one. */
function tabBlock(id: string): string {
  const start = app.indexOf(`{stab === "${id}" && (<>`);
  expect(start, `settings tab "${id}" should exist`).toBeGreaterThan(-1);
  const rest = app.slice(start + 10);
  const next = rest.search(/\{stab === "[a-z]+" && \(<>/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("no tab is a drawer", () => {
  it("nothing is labelled just 'More'", () => {
    expect(app).not.toMatch(/setStab\("more"\)}>More</);
  });

  it("nothing is labelled just 'Data'", () => {
    // "Your data" is fine — it names its contents. A bare "Data" does not.
    expect(app).not.toMatch(/setStab\("data"\)}>Data</);
  });

  it("the keys/phone/people drawer says what is in it", () => {
    expect(app).toMatch(/setStab\("more"\)}>Keys &amp; devices</);
  });
});

describe("things are filed where someone would look for them", () => {
  it("SAM's capabilities are their own tab, not a heading inside Your data", () => {
    const doMore = tabBlock("domore");
    for (const feature of ["Workflows", "Notebooks", "Standing Crew", "Alarms &amp; Timers", "Cameras", "Live usage", "Connected"]) {
      expect(doMore, `${feature} belongs in Do more`).toContain(feature);
    }
  });

  it("Your data holds only data and help, not seven features", () => {
    const data = tabBlock("data");
    expect(data).not.toContain("Workflows");
    expect(data).not.toContain("Standing Crew");
  });

  it("Dark mode is under Appearance, which is the tab about how SAM looks", () => {
    expect(tabBlock("look")).toContain("Dark mode");
    expect(tabBlock("general")).not.toContain("Dark mode");
  });

  it("Voice and Appearance are named for their contents", () => {
    expect(app).toMatch(/setStab\("audio"\)}>Voice</);
    expect(app).toMatch(/setStab\("look"\)}>Appearance</);
  });
});
