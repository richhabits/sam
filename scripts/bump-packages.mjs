#!/usr/bin/env node
// Fill the winget + Flathub manifest templates for a release — the package-manager equivalent of
// the brew-cask auto-bump. Run in the release workflow AFTER the installers + SHA256SUMS exist.
//
//   node scripts/bump-packages.mjs --version 1.5.0
//
// URLs + checksums are read from env when present (set by the release workflow); otherwise the
// GitHub release-asset URLs are inferred and a reminder is printed to fill the SHAs.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : d; };
const version = arg("version", JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version);
const base = `https://github.com/richhabits/sam/releases/download/v${version}`;

const vars = {
  VERSION: version,
  DATE: arg("date", new Date().toISOString().slice(0, 10)),
  INSTALLER_URL: process.env.INSTALLER_URL || `${base}/SAM-Setup-${version}.exe`,
  INSTALLER_SHA256: process.env.INSTALLER_SHA256 || "REPLACE_WITH_SHA256",
  APPIMAGE_URL: process.env.APPIMAGE_URL || `${base}/SAM-${version}.AppImage`,
  APPIMAGE_SHA256: process.env.APPIMAGE_SHA256 || "REPLACE_WITH_SHA256",
};

const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
const outDir = join(root, "packaging", "out");
mkdirSync(join(outDir, "winget"), { recursive: true });
mkdirSync(join(outDir, "flatpak"), { recursive: true });

for (const [srcDir, dst] of [["winget", "winget"], ["flatpak", "flatpak"]]) {
  const dir = join(root, "packaging", srcDir);
  for (const f of readdirSync(dir)) {
    writeFileSync(join(outDir, dst, f), fill(readFileSync(join(dir, f), "utf8")));
  }
}

const missing = Object.entries(vars).filter(([, v]) => String(v).includes("REPLACE_WITH")).map(([k]) => k);
console.log(`✓ Filled winget + flatpak manifests for v${version} → packaging/out/`);
if (missing.length) console.log(`⚠️  Set these before submitting: ${missing.join(", ")} (via env: INSTALLER_SHA256, APPIMAGE_SHA256)`);
