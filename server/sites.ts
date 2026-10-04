// A prompt becomes one page you can open. No GitHub, no terminal, no deploy.
// The file stays in the vault. Publishing, payments and other people's accounts are a later yes.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function sitesDir(): string {
  return join(process.env.VAULT_DIR || join(HERE, "..", "vault"), "sites");
}

export interface SiteBrief {
  name: string;
  line: string;
  points?: string[];
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function siteFilename(name: string, now = new Date()): string {
  const slug = String(name || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `${now.toISOString().slice(0, 10)}-${slug || "site"}.html`;
}

function pointsOf(brief: SiteBrief): string[] {
  const given = (brief.points || []).map((p) => p.trim()).filter(Boolean).slice(0, 3);
  while (given.length < 3) given.push(["Ask in plain language.", "It builds on your machine.", "Nothing goes live until you say so."][given.length]);
  return given;
}

export function renderSite(brief: SiteBrief): string {
  const name = esc((brief.name || "SAM").trim().slice(0, 80) || "SAM");
  const line = esc((brief.line || "Tell it what you want. It builds it.").trim().slice(0, 180));
  const cards = pointsOf(brief).map((p) => `<article><p>${esc(p.slice(0, 140))}</p></article>`).join("");
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
  :root { color-scheme: dark; --bg:#07080c; --ink:#f4f1ea; --dim:#a39c90; --line:rgba(255,244,220,.14); --hot:#ff5a1f; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--ink); font-family: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif; }
  body { min-height: 100vh; background-image: radial-gradient(900px 480px at 80% -10%, rgba(255,90,31,.35), transparent 60%), radial-gradient(700px 400px at -10% 90%, rgba(255,196,120,.12), transparent 55%); }
  main { max-width: 980px; margin: 0 auto; padding: 18vh 28px 12vh; }
  p.mark { letter-spacing: .22em; text-transform: uppercase; font: 600 12px/1 ui-sans-serif, system-ui, sans-serif; color: var(--hot); margin: 0 0 22px; }
  h1 { font-size: clamp(56px, 10vw, 120px); line-height: .88; font-weight: 500; letter-spacing: -0.045em; margin: 0; }
  h2 { font-size: clamp(22px, 3vw, 34px); font-weight: 400; color: var(--dim); max-width: 18ch; margin: 28px 0 0; }
  .row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-top: 12vh; }
  article { border-top: 1px solid var(--line); padding-top: 16px; font: 500 16px/1.4 ui-sans-serif, system-ui, sans-serif; }
  footer { margin-top: 14vh; font: 500 13px/1.4 ui-sans-serif, system-ui, sans-serif; color: var(--dim); }
  @media (max-width: 700px) { .row { grid-template-columns: 1fr; } main { padding-top: 12vh; } }
</style>
<main>
  <p class="mark">Made with SAM</p>
  <h1>${name}</h1>
  <h2>${line}</h2>
  <div class="row">${cards}</div>
  <footer>Built on this computer. Not published. No account. No payment. No invented praise.</footer>
</main>
</html>
`;
}

export function saveSite(brief: SiteBrief, now = new Date()): string {
  const dir = sitesDir();
  mkdirSync(dir, { recursive: true });
  const base = siteFilename(brief.name, now);
  let file = join(dir, base);
  for (let n = 2; existsSync(file) && n < 100; n++) file = join(dir, base.replace(/\.html$/, `-${n}.html`));
  if (resolve(dirname(file)) !== resolve(dir)) throw new Error("refusing to write a site outside the vault");
  writeFileSync(file, renderSite(brief), "utf8");
  return file;
}
