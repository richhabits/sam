import { describe, it, expect, vi, beforeEach } from "vitest";

// The planner is a model call, so every test here mocks it. Nothing in this file may
// reach a provider: a test suite that spends quota is a test suite nobody runs.
let reply = "";
let calls = 0;
vi.mock("../models.ts", () => ({
  runModel: async () => { calls++; return { text: reply, provider: "mock", tier: "free" }; },
}));

import {
  buildSpec, normaliseSpec, fallbackSpec, kindFrom, stackFor, specSummary,
  DEFAULT_STACKS, APP_NOTE,
} from "./spec.ts";

beforeEach(() => { reply = ""; calls = 0; });

describe("reading the kind from the request", () => {
  it("calls a plain site a website", () => {
    expect(kindFrom("build me a one-page booking site for stud services")).toBe("website");
  });
  it("calls a dashboard a webapp", () => {
    expect(kindFrom("build me an admin dashboard for bookings")).toBe("webapp");
  });
  it("calls an endpoints-only request an api", () => {
    expect(kindFrom("build me a webhook api for stripe events")).toBe("api");
  });
  it("prefers pwa when the request asks to install it", () => {
    // "app" and "installable" both appear — installable is the more specific signal.
    expect(kindFrom("build me an installable app for the home screen")).toBe("pwa");
  });
});

describe("the default stacks", () => {
  it("gives a website no backend and no data layer", () => {
    const s = stackFor("website");
    expect(s.backend).toBeNull();
    expect(s.data).toBeNull();
    expect(s.host).toBe("Vercel");
  });
  it("sends an api to Railway", () => {
    expect(stackFor("api").host).toBe("Railway");
  });
  it("switches the data layer to the auth-and-storage platform when the request needs accounts", () => {
    expect(stackFor("webapp", "with user accounts and sign-in").data).toMatch(/Supabase/);
    expect(stackFor("webapp", "a simple tracker").data).toBe(DEFAULT_STACKS.webapp.data);
  });
});

describe("the deterministic plan", () => {
  it("is never empty and is marked as derived", () => {
    const s = fallbackSpec("build me a booking site", "booking site");
    expect(s.derived).toBe(true);
    expect(s.pages.length).toBeGreaterThan(0);
    expect(s.note).toBe(APP_NOTE);
  });
  it("invents no data model it was not told about", () => {
    expect(fallbackSpec("build me a landing page", "landing page").models).toEqual([]);
  });
});

describe("normalising what the model returned", () => {
  it("takes the good fields", () => {
    const s = normaliseSpec({
      kind: "webapp", name: "Bookings", summary: "A booking desk.",
      pages: [{ name: "Home", purpose: "the way in" }, { name: "Diary", purpose: "what is booked" }],
      models: [{ name: "Booking", fields: ["date", "service"] }],
      features: ["email confirmation"], brand: "Hectic Bullz",
    }, "build a booking app", "bookings");
    expect(s.kind).toBe("webapp");
    expect(s.pages.map((p) => p.name)).toEqual(["Home", "Diary"]);
    expect(s.models[0].fields).toEqual(["date", "service"]);
    expect(s.brand).toBe("Hectic Bullz");
    expect(s.derived).toBe(false);
  });

  it("keeps the house stack when the model tries to choose one", () => {
    // The defaults exist because they match infrastructure that is already paid for.
    const s = normaliseSpec({ kind: "website", stack: { host: undefined, frontend: null } }, "a site", "site");
    expect(s.stack.host).toBe("Vercel");
    expect(s.stack.frontend).toBe(DEFAULT_STACKS.website.frontend);
  });

  it("refuses a kind that is not one of the four", () => {
    const s = normaliseSpec({ kind: "spaceship" }, "build me a booking site", "site");
    expect(s.kind).toBe("website");
  });

  it("drops malformed pages and models rather than failing", () => {
    const s = normaliseSpec({
      kind: "website",
      pages: [{ purpose: "no name" }, { name: "Home", purpose: "fine" }, 42],
      models: [{ fields: ["orphan"] }, { name: "Booking", fields: ["date", 7] }],
    }, "a site", "site");
    expect(s.pages.map((p) => p.name)).toEqual(["Home"]);
    expect(s.models).toEqual([{ name: "Booking", fields: ["date"] }]);
  });

  it("falls back whole when handed something that is not an object", () => {
    for (const junk of [null, "a string", 7]) {
      expect(normaliseSpec(junk, "build me a site", "site").derived).toBe(true);
    }
  });

  it("always carries the honest note about what app means", () => {
    expect(normaliseSpec({ kind: "pwa", note: "something else entirely" }, "an app", "app").note).toBe(APP_NOTE);
  });
});

describe("asking for a spec", () => {
  it("uses the model's plan when it returns usable JSON", async () => {
    reply = JSON.stringify({ kind: "website", name: "Stud Services", summary: "A booking page.", pages: [{ name: "Home", purpose: "book" }] });
    const s = await buildSpec("build me a booking site", "booking site");
    expect(calls).toBe(1);
    expect(s.derived).toBe(false);
    expect(s.name).toBe("Stud Services");
  });

  it("finds the object even when the model wraps it in prose", async () => {
    reply = "Sure! Here you go:\n```json\n{\"kind\":\"api\",\"name\":\"Hooks\"}\n```\nHope that helps.";
    const s = await buildSpec("build me a webhook api", "hooks");
    expect(s.kind).toBe("api");
    expect(s.derived).toBe(false);
  });

  it("derives a plan when the model returns no JSON at all", async () => {
    reply = "I would love to help you build that!";
    const s = await buildSpec("build me a booking site", "booking site");
    expect(s.derived).toBe(true);
    expect(s.pages.length).toBeGreaterThan(0);
  });

  it("derives a plan when the model throws", async () => {
    reply = "{ this is not json";
    const s = await buildSpec("build me a booking site", "booking site");
    expect(s.derived).toBe(true);
  });
});

describe("showing the plan", () => {
  it("names the stack and the honest constraint", () => {
    const out = specSummary(fallbackSpec("build me a booking site", "booking site"));
    expect(out).toContain("Vercel");
    expect(out).toContain("native App Store binary");
  });
  it("says so when the planner was unavailable", () => {
    expect(specSummary(fallbackSpec("a site", "site"))).toContain("planner was unavailable");
  });
  it("calls them screens for an app and pages for a site", () => {
    const app = normaliseSpec({ kind: "webapp", pages: [{ name: "Diary" }] }, "an app", "app");
    expect(specSummary(app)).toContain("**Screens**");
    const site = normaliseSpec({ kind: "website", pages: [{ name: "Home" }] }, "a site", "site");
    expect(specSummary(site)).toContain("**Pages**");
  });
});

describe("the name a plan is shown under", () => {
  // Found by driving it: the plan came back titled "…stud services, on-bra". Harmless
  // while a name only labelled a job; not harmless once it is the heading on something
  // the operator reads before confirming.
  it("cuts on a word boundary, not mid-word", async () => {
    const request = "build me a one-page booking site for Hectic Bullz stud services, on-brand";
    const { nameFrom } = await import("./intent.ts");
    const n = nameFrom(request);
    expect(n.length).toBeLessThanOrEqual(60);
    expect(n).not.toMatch(/on-bra$/);
    // Every word kept is a whole word from the request.
    for (const word of n.split(" ")) expect(request).toContain(word);
  });

  it("still bounds a request with no space to cut on", async () => {
    const { nameFrom } = await import("./intent.ts");
    expect(nameFrom(`build me a ${"x".repeat(120)}`).length).toBeLessThanOrEqual(60);
  });
});
