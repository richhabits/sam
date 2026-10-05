import { describe, expect, it } from "vitest";
import { appendToolTrace, seedLiveTrace, STARTING_STEP } from "./liveTrace";

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
});
