import { describe, it, expect } from "vitest";

// Mirrors docs/install.sh asset pick. Intel used to match arm64.dmg because
// that filename also has a digit immediately before `.dmg`.
function pickMac(arch: "arm64" | "x64", urls: string[]): string | undefined {
  if (arch === "arm64") return urls.find((u) => /arm64\.dmg$/.test(u));
  return urls.find((u) => /\.dmg$/.test(u) && !u.includes("arm64"));
}

const v360 = [
  "https://github.com/richhabits/sam/releases/download/v3.6.0/SAM-3.6.0-arm64.dmg",
  "https://github.com/richhabits/sam/releases/download/v3.6.0/SAM-3.6.0-arm64.dmg.blockmap",
  "https://github.com/richhabits/sam/releases/download/v3.6.0/SAM-3.6.0.AppImage",
  "https://github.com/richhabits/sam/releases/download/v3.6.0/SAM-Setup-3.6.0.exe",
];

describe("install.sh mac asset pick", () => {
  it("Apple Silicon gets the arm64 dmg, not the blockmap", () => {
    expect(pickMac("arm64", v360)?.endsWith("SAM-3.6.0-arm64.dmg")).toBe(true);
  });
  it("Intel does not get the arm64 dmg when no Intel image exists", () => {
    expect(pickMac("x64", v360)).toBeUndefined();
  });
  it("Intel gets SAM-x.y.z.dmg when that asset exists", () => {
    const withIntel = [...v360, "https://example/SAM-3.6.0.dmg"];
    expect(pickMac("x64", withIntel)?.endsWith("SAM-3.6.0.dmg")).toBe(true);
  });
});
