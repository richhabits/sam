import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// VAULT_DIR is read at import time — point it at a fresh dir and re-import the module each test.
let dir: string;
let prevVault: string | undefined;
let C: typeof import("./cameras.ts");
beforeEach(async () => {
  prevVault = process.env.VAULT_DIR;
  dir = mkdtempSync(join(tmpdir(), "sam-cam-"));
  process.env.VAULT_DIR = dir;
  vi.resetModules();
  C = await import("./cameras.ts");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (prevVault === undefined) delete process.env.VAULT_DIR; else process.env.VAULT_DIR = prevVault;
  delete process.env.SAM_CAMERAS;
});

describe("the Watch — local camera registry", () => {
  it("is OFF unless SAM_CAMERAS=1", () => {
    expect(C.camerasEnabled()).toBe(false);
    process.env.SAM_CAMERAS = "1";
    expect(C.camerasEnabled()).toBe(true);
  });

  it("accepts a LAN snapshot url and lists it", () => {
    const r = C.add({ name: "Nursery", location: "nursery", kind: "snapshot", url: "http://192.168.1.42/snapshot.jpg" });
    expect(r.ok).toBe(true);
    expect(C.list()).toHaveLength(1);
    expect(C.list()[0].name).toBe("Nursery");
  });

  it("REFUSES a public url (no exfiltration/SSRF target)", () => {
    const r = C.add({ name: "Sketchy", kind: "snapshot", url: "http://evil.example.com/x.jpg" });
    expect(r.ok).toBe(false);
    expect(C.list()).toHaveLength(0);
  });

  it("accepts loopback, .local, and 10/172.16-31/169.254 ranges; rejects public IPs", () => {
    for (const ok of ["rtsp://127.0.0.1:554/stream", "http://cam.local/s.jpg", "http://10.0.0.9/s", "http://172.20.5.5/s", "http://169.254.1.1/s"]) {
      expect(C.isLocalUrl(ok)).toBe(true);
    }
    for (const bad of ["http://8.8.8.8/s", "https://1.2.3.4/s", "http://172.32.0.1/s", "ftp://192.168.1.1/s", "not-a-url"]) {
      expect(C.isLocalUrl(bad)).toBe(false);
    }
  });

  it("a snapshot/rtsp camera with no url is refused", () => {
    expect(C.add({ name: "x", kind: "snapshot" }).ok).toBe(false);
  });

  it("a ring camera is a placeholder — added, but carries no url (unlinked)", () => {
    const r = C.add({ name: "Front Door", kind: "ring" });
    expect(r.ok).toBe(true);
    expect(C.list()[0].url).toBeUndefined();
    expect(C.list()[0].kind).toBe("ring");
  });

  it("remove deletes by id and reports hit/miss", () => {
    const r = C.add({ name: "Dog", kind: "snapshot", url: "http://192.168.0.5/s.jpg" });
    const id = (r as any).camera.id;
    expect(C.remove("nope")).toBe(false);
    expect(C.remove(id)).toBe(true);
    expect(C.list()).toHaveLength(0);
  });

  it("an unnamed camera is refused", () => {
    expect(C.add({ name: "  ", kind: "snapshot", url: "http://192.168.1.1/s" }).ok).toBe(false);
  });
});
