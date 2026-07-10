import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { rmSync } from "node:fs";

const SCRATCH = "/tmp/sam-consent-test";
let C: typeof import("./consent.ts");
let T: typeof import("./triggers.ts");
let L: typeof import("./autonomy-log.ts");
let A: typeof import("./authz.ts");

beforeAll(async () => {
  process.env.VAULT_DIR = SCRATCH;
  rmSync(SCRATCH, { recursive: true, force: true });
  C = await import("./consent.ts");
  T = await import("./triggers.ts");
  L = await import("./autonomy-log.ts");
  A = await import("./authz.ts");
});
beforeEach(() => { C.disableAll(); L.clearAutonomyLog(); });

const NOW = "2026-07-10T09:00:00.000Z";

describe("autonomy consent (v1.8 trust contract)", () => {
  it("EVERY behavior is OFF by default", () => {
    for (const b of C.BEHAVIORS) expect(C.isEnabled(b.id)).toBe(false);
    expect(C.consentState().every((b) => b.enabled === false)).toBe(true);
  });

  it("an unknown behavior is never enabled", () => {
    expect(C.isEnabled("totally-made-up" as any)).toBe(false);
    expect(C.setEnabled("totally-made-up" as any, true)).toBe(false);
  });

  it("enabling one behavior does NOT enable the others", () => {
    C.setEnabled("daily-briefing", true);
    expect(C.isEnabled("daily-briefing")).toBe(true);
    for (const b of C.BEHAVIORS.filter((x) => x.id !== "daily-briefing")) expect(C.isEnabled(b.id)).toBe(false);
  });

  it("disableAll() turns everything back off", () => {
    C.setEnabled("reminders", true); C.setEnabled("file-watch-suggestions", true);
    C.disableAll();
    for (const b of C.BEHAVIORS) expect(C.isEnabled(b.id)).toBe(false);
  });
});

describe("triggers only surface — never execute", () => {
  it("produces NO cards when the behavior is disabled", () => {
    const cards = T.evaluateTriggers({ now: NOW, newFiles: [{ path: "/x/contract.pdf", name: "contract.pdf" }], dueReminders: [{ id: "r1", text: "call the bank" }] });
    expect(cards).toHaveLength(0);
    expect(L.readAutonomyLog()).toHaveLength(0);   // nothing surfaced ⇒ nothing logged
  });

  it("surfaces cards ONLY for enabled behaviors, and logs each as 'suggested'", () => {
    C.setEnabled("file-watch-suggestions", true);   // reminders stays OFF
    const cards = T.evaluateTriggers({ now: NOW, newFiles: [{ path: "/x/contract.pdf", name: "contract.pdf" }], dueReminders: [{ id: "r1", text: "call the bank" }] });
    expect(cards.map((c) => c.behavior)).toEqual(["file-watch-suggestions"]);   // reminder NOT surfaced (off)
    const log = L.readAutonomyLog();
    expect(log).toHaveLength(1);
    expect(log[0].kind).toBe("suggested");          // surfaced, never "acted"
    expect(log.every((e) => e.kind !== "acted")).toBe(true);
  });

  it("a suggested SAFE tool is flagged dangerous:false", () => {
    C.setEnabled("file-watch-suggestions", true);
    const [card] = T.evaluateTriggers({ now: NOW, newFiles: [{ path: "/x/a.txt", name: "a.txt" }] });
    expect(card.action?.tool).toBe("read_file");
    expect(card.dangerous).toBe(false);
  });

  it("if a suggested action's tool IS dangerous, the card is flagged dangerous (gate still applies on accept)", () => {
    C.setEnabled("file-watch-suggestions", true);
    A.markDangerous("read_file");                   // pretend the suggested tool became dangerous
    try {
      const [card] = T.evaluateTriggers({ now: NOW, newFiles: [{ path: "/x/a.txt", name: "a.txt" }] });
      expect(card.dangerous).toBe(true);            // flagging tracks authz.isDangerous
    } finally { A.unmarkDangerous("read_file"); }
  });
});
