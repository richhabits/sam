import { describe, expect, it } from "vitest";
import { appendToolTrace, persistToolTrace, STARTING_STEP, seedLiveTrace } from "./liveTrace";

describe("liveTrace", () => {
  it("starts with a visible free-lane step so first paint is the work", () => {
    expect(seedLiveTrace()).toEqual([STARTING_STEP]);
  });

  it("drops the placeholder once a real tool fires", () => {
    expect(appendToolTrace(seedLiveTrace(), "searching the web")).toEqual(["searching the web"]);
  });

  it("appends further tools in order", () => {
    expect(appendToolTrace(["searching the web"], "reading the page")).toEqual([
      "searching the web",
      "reading the page",
    ]);
  });

  it("persists real tools and drops the warm-up placeholder", () => {
    expect(persistToolTrace([STARTING_STEP], ["searching the web", STARTING_STEP])).toEqual(["searching the web"]);
    expect(persistToolTrace(undefined, [STARTING_STEP])).toBeUndefined();
    expect(persistToolTrace(["reading the page"], ["searching the web", "reading the page"])).toEqual([
      "reading the page",
      "searching the web",
    ]);
  });
});
