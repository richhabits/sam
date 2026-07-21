// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — putting a project on the internet
//
//  Deploying is the one thing the yard does that the outside world can see, so it is
//  the one thing built to refuse rather than guess. It never runs on its own: a deploy
//  is a job somebody asks for, and a job that cannot be authorised fails saying exactly
//  what is missing instead of half-shipping.
//
//  The credential is handled carefully for a specific reason. Every other job runs with
//  a scrubbed environment — a nine-key whitelist with HOME pointed at the project — so
//  nothing a build runs can see the vault. A deploy needs ONE secret, so it gets exactly
//  that one, injected for this job alone, and passed through the environment rather than
//  the command line: arguments are visible to anyone who can list processes, and a token
//  on the command line is a token in everybody's `ps` output.
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as safe from "../safe.ts";

export type Target = "vercel";

// Read the secret from the Safe first, then the environment — the same order the rest of
// SAM uses, so a sealed vault works here too.
export function deployToken(target: Target = "vercel"): string | null {
  const name = target === "vercel" ? "VERCEL_TOKEN" : "";
  if (!name) return null;
  try {
    if (safe.isSetup() && safe.isUnlocked()) {
      const v = safe.get(name);
      if (v) return v;
    }
  } catch { /* a locked Safe simply means falling through to the environment */ }
  return process.env[name] || null;
}

export interface Shape {
  kind: "static" | "built";
  buildCommand: string[] | null;   // what to run first, if anything
  outputDir: string | null;        // what the built site lands in
  reason: string;                  // said out loud, because guessing wrong wastes a deploy
}

// Work out what this project IS before trying to ship it. Deliberately conservative:
// anything it cannot recognise is treated as a plain static site, which is the outcome
// that fails visibly rather than the one that publishes something wrong.
export function readShape(dir: string): Shape {
  const pkgPath = join(dir, "package.json");
  if (!existsSync(pkgPath)) {
    return { kind: "static", buildCommand: null, outputDir: null, reason: "no package.json — shipping the files as they are" };
  }
  let pkg: any = {};
  try { pkg = JSON.parse(readFileSync(pkgPath, "utf8")); } catch {
    return { kind: "static", buildCommand: null, outputDir: null, reason: "package.json could not be read — shipping the files as they are" };
  }
  const build = pkg?.scripts?.build;
  if (!build) {
    return { kind: "static", buildCommand: null, outputDir: null, reason: "no build script — shipping the files as they are" };
  }
  // Only the output directories that actually exist after a build are claimed; naming one
  // that never appears would make the deploy publish an empty site and call it a success.
  const candidates = ["dist", "build", "out", ".output/public", "public"];
  const found = candidates.find((c) => existsSync(join(dir, c)));
  return {
    kind: "built",
    buildCommand: ["npm", "run", "build"],
    outputDir: found ?? null,
    reason: found ? `build script + ${found}` : "build script, output directory not created yet",
  };
}

export type DeployRefusal = { ok: false; reason: string };
export type DeployPlan = { ok: true; shape: Shape; args: string[]; env: Record<string, string> };

// Everything needed to ship, or a refusal that names what is missing. Pure, so the
// decisions can be argued with without a network or an account.
export function planDeploy(dir: string, opts: { target?: Target; token?: string | null; production?: boolean } = {}): DeployPlan | DeployRefusal {
  const target = opts.target ?? "vercel";
  const token = opts.token === undefined ? deployToken(target) : opts.token;

  if (!token) {
    return { ok: false, reason: "there is no VERCEL_TOKEN in the vault, so the yard cannot deploy. Create a scoped token at vercel.com/account/tokens and add it to .env — the yard injects it into deploy jobs only, never into a build." };
  }
  if (!existsSync(dir)) return { ok: false, reason: `there is no project at ${dir}` };

  const shape = readShape(dir);
  if (shape.kind === "static" && !existsSync(join(dir, "index.html"))) {
    return { ok: false, reason: "this project has neither a build script nor an index.html, so there is nothing to publish yet" };
  }

  // --yes so it never sits waiting on a prompt inside a job nobody is watching.
  const args = ["deploy", "--yes"];
  if (opts.production !== false) args.push("--prod");

  // The token goes in the ENVIRONMENT, not the arguments. Anything on the command line
  // is visible to every process on the machine that can run `ps`.
  return { ok: true, shape, args, env: { VERCEL_TOKEN: token } };
}

// Vercel prints progress and the final URL together; the URL is what matters and it is
// the last one it names. Pulled out rather than assumed, so a changed output format
// fails to find a URL instead of reporting a wrong one.
export function urlFrom(output: string): string | null {
  const matches = String(output || "").match(/https:\/\/[a-z0-9][a-z0-9._-]*\.vercel\.app\b/gi);
  if (!matches?.length) return null;
  return matches[matches.length - 1];
}

export interface SmokeResult { ok: boolean; status: number | null; detail: string }

// A deploy that returns a URL is not the same as a deploy that WORKS. Fetching it is the
// difference between "the command exited zero" and "there is a page there".
export async function smokeTest(url: string, fetchImpl: typeof fetch = fetch): Promise<SmokeResult> {
  try {
    const res = await fetchImpl(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const body = res.status === 200 ? await res.text().catch(() => "") : "";
    if (res.status !== 200) return { ok: false, status: res.status, detail: `the live URL answered ${res.status}` };
    if (!body.trim()) return { ok: false, status: 200, detail: "the live URL answered 200 but the page was empty" };
    return { ok: true, status: 200, detail: `live, ${body.length} bytes` };
  } catch (e: any) {
    return { ok: false, status: null, detail: `could not reach the live URL — ${String(e?.message || e).slice(0, 120)}` };
  }
}
