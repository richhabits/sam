// The Pocket tells you where to click on the Mac. If that sentence and the Mac's actual menu ever
// disagree, the instruction is worse than none — you follow it, the button isn't there, and the
// obvious conclusion is that pairing is broken.
//
// That is not hypothetical. Until 2026-08-12 the app said "SAM → Dashboard → Pair a phone" while
// the Dashboard's tabs were Overview / Brains / Automations / People / Activity, with the button
// two levels down inside **Automations**. Following the app's own instruction could not work.
//
// These assertions are deliberately about SOURCE TEXT, which is usually the weak form of a test —
// here it is the right one, because the thing being checked IS two files agreeing on a string. A
// behavioural test of the Dashboard would not notice the phone saying something different.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

describe("the route the phone tells you to take exists on the Mac", () => {
  const dashboard = read("src/Dashboard.tsx");
  const pocket = read("mobile/App.tsx");

  it("the Dashboard has a Devices tab", () => {
    expect(dashboard).toContain('setTab("devices")');
    expect(dashboard).toContain('{tab === "devices" && (<>');
  });

  it("pairing lives in that tab, not in Automations", () => {
    const devicesTab = dashboard.slice(dashboard.indexOf('{tab === "devices" && (<>'));
    const untilNextTab = devicesTab.slice(0, devicesTab.indexOf('{tab === "auto" && (<>'));
    expect(untilNextTab).toContain("Pair a phone");
  });

  it("the Pocket names that exact path", () => {
    // The whole point: the words in the app match the tabs on the Mac.
    expect(pocket).toContain("Dashboard → Devices → Pair a phone");
  });

  it("does not still send people to the path that never worked", () => {
    expect(pocket).not.toContain("SAM → Dashboard → Pair a phone)");
  });
});

describe("the two ways to reach SAM from a phone are told apart", () => {
  // One is a remote-access token opened in the phone's browser; the other is a one-time code that
  // pairs the native app. They are not interchangeable, and both used to be called "phone".
  it("the browser route says it is the browser, and points at the app route", () => {
    const admin = read("src/Admin.tsx");
    expect(admin).toContain("Open SAM in your phone's browser");
    expect(admin).toContain("Dashboard → Devices → Pair a phone");
  });

  it("the app route points back at the browser route", () => {
    expect(read("src/Dashboard.tsx")).toContain("Settings → Devices");
  });
});
