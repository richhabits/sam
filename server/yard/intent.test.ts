import { describe, it, expect } from "vitest";
import { read, routeOrNull, nameFrom, projectFrom, CONFIDENT } from "./intent.ts";

// The asymmetry under test: reading a build request as chat costs a repeat; reading
// chat as a build request starts a job, writes files and spends money. So the large
// half of this file is about NOT leaving the conversation.

const KNOWN = [
  { slug: "hello-site", name: "Hello Site" },
  { slug: "booking", name: "Booking" },
];

describe("asking for something new", () => {
  it("hears a plain build request", () => {
    const r = read("build me a one-page hello site", KNOWN);
    expect(r.intent).toBe("BUILD_NEW");
    expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENT);
  });

  it("hears the other ways people ask", () => {
    for (const m of [
      "make me a landing page for the gym",
      "create a portfolio site",
      "can you build a dashboard for the numbers",
      "knock up a booking system",
      "spin up an api for the bookings",
    ]) expect(read(m, []).intent).toBe("BUILD_NEW");
  });

  it("takes a usable name from the request", () => {
    expect(nameFrom("build me a booking site for the stud services")).toBe("booking site for the stud services");
    expect(nameFrom("make a landing page")).toBe("landing page");
    expect(nameFrom("")).toBe("new project");
  });
});

describe("changing something that already exists", () => {
  it("hears an edit when a known project is named", () => {
    const r = read("add a contact form to the hello site", KNOWN);
    expect(r.intent).toBe("EDIT_EXISTING");
    expect(r.slug).toBe("hello-site");
  });

  it("reads it as an edit when the sentence binds the work TO an existing project", () => {
    const r = read("build another page for the hello site", KNOWN);
    expect(r.intent).toBe("EDIT_EXISTING");
    expect(r.slug).toBe("hello-site");
  });

  it("still reads a plain creation as NEW even when the words overlap an existing project", () => {
    // "a one-page hello site" describes something to make; it does not ask to change
    // the project that happens to share those words. Making a spare project is
    // recoverable — editing the wrong one is not — so ambiguity resolves to NEW.
    expect(read("build me a one-page hello site", KNOWN).intent).toBe("BUILD_NEW");
    expect(read("make a booking site", KNOWN).intent).toBe("BUILD_NEW");
  });

  it("matches a project by its slug as well as its name", () => {
    expect(projectFrom("update the booking thing", KNOWN)).toBe("booking");
    expect(projectFrom("tweak hello site please", KNOWN)).toBe("hello-site");
  });

  it("will not invent a project to edit when none is named", () => {
    // a change word, but nothing to point it at
    expect(read("add a contact form", KNOWN).intent).toBe("CHAT");
  });

  it("knows nothing when no projects exist yet", () => {
    expect(projectFrom("update the hello site", [])).toBeNull();
    expect(read("update the hello site", []).intent).toBe("CHAT");
  });
});

describe("asking how work is going", () => {
  it("hears the direct questions", () => {
    for (const m of ["status", "jobs", "what's running", "how's the build going", "is it done", "job status"]) {
      expect(read(m, KNOWN).intent).toBe("JOB_STATUS");
    }
  });

  it("hears a job named outright", () => {
    expect(read("what happened with job_mru2a9fb_v620p2", KNOWN).intent).toBe("JOB_STATUS");
  });
});

describe("what must stay conversation", () => {
  it("leaves ordinary talk alone", () => {
    for (const m of [
      "what's the weather",
      "I'm just talking with my friends I'm good",
      "who won the match",
      "remind me what the ladder rungs are",
      "how much have I spent this month",
      "thanks, that's great",
    ]) expect(read(m, KNOWN).intent).toBe("CHAT");
  });

  it("does not mistake a question ABOUT building for a request to build", () => {
    for (const m of [
      "how do I build a website",
      "how would you build a booking system",
      "what's the best way to make a landing page",
      "can you explain how to create an api",
      "should i build an app or a site",
    ]) expect(read(m, KNOWN).intent).toBe("CHAT");
  });

  it("does not fire on making words that have nothing to do with software", () => {
    for (const m of [
      "make me a coffee",
      "build up my confidence",
      "create a bit of space in the diary",
      "set up a call with the vet",
      "put together the numbers for last month",
    ]) expect(read(m, KNOWN).intent).toBe("CHAT");
  });

  it("refuses a build request that names nothing buildable", () => {
    // no artefact — a job made from this would be entirely guesswork
    for (const m of ["build me something amazing", "make me something cool", "create something for the business"]) {
      expect(read(m, KNOWN).intent).toBe("CHAT");
    }
  });

  it("treats an empty message as conversation", () => {
    expect(read("", KNOWN).intent).toBe("CHAT");
    expect(read("   ", KNOWN).intent).toBe("CHAT");
  });
});

describe("the one question the chat path asks", () => {
  it("returns nothing for conversation, so the existing path runs untouched", () => {
    for (const m of ["what's the weather", "how do I build a site", "make me a coffee", "hello"]) {
      expect(routeOrNull(m, KNOWN)).toBeNull();
    }
  });

  it("returns a reading only when it is sure", () => {
    expect(routeOrNull("build me a one-page hello site", [])).not.toBeNull();
    expect(routeOrNull("status", [])).not.toBeNull();
  });

  it("never returns anything below the confidence bar", () => {
    const messages = [
      "build me a one-page hello site", "add a form to the hello site", "status",
      "what's the weather", "how do I build a site", "make me a coffee",
    ];
    for (const m of messages) {
      const r = routeOrNull(m, KNOWN);
      if (r) expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENT);
    }
  });
});
