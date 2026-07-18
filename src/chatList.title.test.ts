import { describe, expect, it } from "vitest";
import { displayTitle } from "./ChatList";

// The project has no jsdom/testing-library, so this covers ChatList's non-visual logic:
// which string a row actually shows. Rendering is not exercised here.
const base = { id: "1", at: 0, messages: [] as { text: string }[] };

describe("displayTitle", () => {
  it("prefers an explicit user-set name over the auto-derived title", () => {
    expect(displayTitle({ ...base, title: "triage my inbox", name: "Inbox cleanup" }))
      .toBe("Inbox cleanup");
  });

  it("ignores a whitespace-only name and falls back to the auto title", () => {
    expect(displayTitle({ ...base, title: "triage my inbox", name: "   " }))
      .toBe("Triage my inbox");
  });

  it("cleans the auto-derived title", () => {
    expect(displayTitle({ ...base, title: "👁️ looking through the camera" }))
      .toBe("Looking through the camera");
  });

  it("falls back to the first message when the title cleans to nothing", () => {
    expect(displayTitle({ ...base, title: "🚀", messages: [{ text: "deploy the thing" }] }))
      .toBe("Deploy the thing");
  });

  it("ends at 'New chat' when there is nothing at all to title from", () => {
    expect(displayTitle({ ...base, title: "" })).toBe("New chat");
    expect(displayTitle({ ...base, title: "😀", messages: [{ text: "🎉" }] })).toBe("New chat");
  });
});
