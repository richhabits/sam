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
  "https://github.com/richhabits/sam/releases/download/v3.6.0/sam_3.6.0_amd64.deb",
  "https://github.com/richhabits/sam/releases/download/v3.6.0/SAM-Setup-3.6.0.exe",
];

function pickLinux(arch: "arm64" | "x64", pkg: "appimage" | "deb", urls: string[]): string | undefined {
  if (arch !== "x64") return undefined;
  if (pkg === "deb") return urls.find((u) => /\.deb$/.test(u));
  return urls.find((u) => /\.AppImage$/.test(u));
}

describe("install.ps1 Windows asset pick", () => {
  it("matches SAM-Setup-x.y.z.exe and not the blockmap", () => {
    const names = ["SAM-Setup-3.6.0.exe", "SAM-Setup-3.6.0.exe.blockmap", "SAM-3.6.0-arm64.dmg"];
    const hit = names.filter((n) => /SAM-Setup-.*\.exe$/.test(n));
    expect(hit).toEqual(["SAM-Setup-3.6.0.exe"]);
  });
});

describe("install.sh linux asset pick", () => {
  it("x64 gets the AppImage; SAM_PKG=deb gets sam_*_amd64.deb", () => {
    expect(pickLinux("x64", "appimage", v360)?.endsWith("SAM-3.6.0.AppImage")).toBe(true);
    expect(pickLinux("x64", "deb", v360)?.endsWith("sam_3.6.0_amd64.deb")).toBe(true);
  });
  it("linux arm64 gets nothing rather than the amd64 image", () => {
    expect(pickLinux("arm64", "appimage", v360)).toBeUndefined();
  });
});

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
