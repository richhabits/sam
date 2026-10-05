import { describe, expect, it } from "vitest";
import { loadOnboarded, markOnboarded, ONBOARDED_KEY, PROFILE_KEY, seedWelcomeOnFinish, welcomeText } from "./onboarding";

function mem(init: Record<string, string> = {}) {
  const store = { ...init };
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    store,
  };
}

describe("loadOnboarded", () => {
  it("lets an existing named profile skip the wall", () => {
    const s = mem({ [PROFILE_KEY]: JSON.stringify({ name: "Romeo" }) });
    expect(loadOnboarded(s)).toBe(true);
  });

  it("treats a blank profile as not yet through first-run", () => {
    const s = mem({ [PROFILE_KEY]: JSON.stringify({ name: "  " }) });
    expect(loadOnboarded(s)).toBe(false);
  });

  it("honours an explicit skip flag so chat opens with no name", () => {
    const s = mem({ [ONBOARDED_KEY]: "1" });
    expect(loadOnboarded(s)).toBe(true);
  });
});

describe("markOnboarded", () => {
  it("writes the skip flag", () => {
    const s = mem();
    markOnboarded(s);
    expect(s.store[ONBOARDED_KEY]).toBe("1");
    expect(loadOnboarded(s)).toBe(true);
  });
});

describe("welcome", () => {
  it("only seeds a greeting when they gave a name — skip shows chips", () => {
    expect(seedWelcomeOnFinish("Romeo")).toBe(true);
    expect(seedWelcomeOnFinish("  ")).toBe(false);
  });

  it("says chat is the app and names the free lane", () => {
    expect(welcomeText("Romeo")).toContain("Chat is the app");
    expect(welcomeText("Romeo")).toContain("free lane");
    expect(welcomeText("")).toContain("tap a chip");
  });
});
