import { describe, it, expect } from "vitest";
import { runDoctor, type DoctorWorld } from "./doctor.ts";

const world = (over: Partial<DoctorWorld> = {}): DoctorWorld => ({
  hasCloudKeys: true, ollamaConfigured: false, ollamaReachable: false, online: true, vaultWritable: true, platform: "linux", ...over,
});
const byId = (r: ReturnType<typeof runDoctor>, id: string) => r.checks.find((c) => c.id === id)!;

describe("doctor — turns failures into exact fixes", () => {
  it("all-good ⇒ healthy, no fixes", () => {
    const r = runDoctor(world());
    expect(r.healthy).toBe(true);
    expect(r.checks.every((c) => c.status !== "fail")).toBe(true);
  });

  it("NO brain at all ⇒ fails with the add-a-key/install-Ollama fix", () => {
    const r = runDoctor(world({ hasCloudKeys: false, ollamaConfigured: false }));
    expect(r.healthy).toBe(false);
    const b = byId(r, "brain");
    expect(b.status).toBe("fail");
    expect(b.fix).toMatch(/free key|Ollama/i);
  });

  it("Ollama configured but not running ⇒ tells you to start it", () => {
    const r = runDoctor(world({ hasCloudKeys: false, ollamaConfigured: true, ollamaReachable: false }));
    const o = byId(r, "ollama");
    expect(o.status).toBe("fail");                 // no cloud fallback ⇒ hard fail
    expect(o.fix).toMatch(/ollama serve|Ollama app/i);
  });

  it("offline WITH a local model ⇒ that's fine, not a failure", () => {
    const r = runDoctor(world({ hasCloudKeys: false, ollamaConfigured: true, ollamaReachable: true, online: false }));
    expect(r.healthy).toBe(true);
    expect(byId(r, "network").status).toBe("ok");
  });

  it("offline WITHOUT a local model ⇒ warns + offers Ollama", () => {
    const r = runDoctor(world({ hasCloudKeys: false, online: false }));
    expect(byId(r, "network").status).toBe("warn");
    expect(byId(r, "network").fix).toMatch(/reconnect|Ollama/i);
  });

  it("vault not writable ⇒ hard fail", () => {
    const r = runDoctor(world({ vaultWritable: false }));
    expect(r.healthy).toBe(false);
    expect(byId(r, "vault").status).toBe("fail");
  });

  it("macOS adds the overlay/Accessibility guidance", () => {
    expect(byId(runDoctor(world({ platform: "darwin" })), "accessibility").fix).toMatch(/Accessibility/i);
    expect(runDoctor(world({ platform: "win32" })).checks.some((c) => c.id === "accessibility")).toBe(false);
  });
});
