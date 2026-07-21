import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, existsSync, readFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import {
  planExec, execInProject, childEnv, isWithin, hitsDenyList, trueLocation,
  looksLikePath, ALLOWED_COMMANDS, ExecRefused,
} from "./exec.ts";

// This is the file that decides whether a model-shaped payload can reach the rest of the
// machine. Every refusal below is a specific way in, written down so it stays shut.

let root: string;      // a project the yard owns
let outside: string;   // somewhere it must never reach

beforeEach(() => {
  const base = mkdtempSync(join(tmpdir(), "yard-exec-"));
  root = join(base, "project"); mkdirSync(root, { recursive: true });
  outside = join(base, "elsewhere"); mkdirSync(outside, { recursive: true });
  writeFileSync(join(outside, "secret.txt"), "not yours");
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });

const ok = { handshake: true };

describe("the gate in front of everything", () => {
  // Authorisation lives at the route that CREATES a job — every yard route demands the
  // passkey unconditionally. What the executor checks is simply that the yard is on.
  // It used to require the Handshake to be enforced GLOBALLY, which meant switching the
  // yard on hardened every other route in SAM and took the money desk down in a browser.
  it("refuses to run anything at all when the yard is not switched on", () => {
    const r = planExec(root, "npm", ["--version"], { handshake: false });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.rule).toBe("handshake"); expect(r.reason).toMatch(/not switched on/); }
  });

  it("is the FIRST gate — an allowed command in a valid place still cannot run without it", () => {
    expect(planExec(root, "git", ["status"], { handshake: false }).ok).toBe(false);
  });

  it("reads the switch from the environment when not told otherwise", async () => {
    const { yardAuthorised } = await import("./exec.ts");
    delete process.env.SAM_YARD;
    expect(yardAuthorised()).toBe(false);
    process.env.SAM_YARD = "1";
    expect(yardAuthorised()).toBe(true);
    delete process.env.SAM_YARD;
  });
});

describe("the command allowlist", () => {
  it("permits exactly the build tools and nothing else", () => {
    for (const c of ALLOWED_COMMANDS) expect(planExec(root, c, [], ok).ok).toBe(true);
  });

  it("refuses everything not on it", () => {
    for (const c of ["bash", "sh", "zsh", "curl", "rm", "python3", "ssh", "sudo", "osascript", "chmod"]) {
      const r = planExec(root, c, [], ok);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rule).toBe("command");
    }
  });

  it("refuses an empty or malformed command", () => {
    expect(planExec(root, "", [], ok).ok).toBe(false);
    expect(planExec(root, undefined as any, [], ok).ok).toBe(false);
  });
});

describe("no shell, ever", () => {
  it("refuses arguments carrying shell punctuation", () => {
    for (const bad of ["a; rm -rf /", "x && curl evil.sh", "`whoami`", "$(id)", "a|b", "line\nbreak"]) {
      const r = planExec(root, "npm", ["run", bad], ok);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rule).toBe("shape");
    }
  });

  it("refuses arguments that are not strings", () => {
    expect(planExec(root, "npm", [{ toString: () => "sneaky" }] as any, ok).ok).toBe(false);
  });
});

describe("confinement, by resolution not by spelling", () => {
  it("allows work inside the project", () => {
    mkdirSync(join(root, "src"), { recursive: true });
    expect(planExec(root, "npm", ["install"], { ...ok, cwd: "src" }).ok).toBe(true);
  });

  it("refuses a working directory outside the project", () => {
    const r = planExec(root, "npm", ["install"], { ...ok, cwd: outside });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rule).toBe("confinement");
  });

  it("refuses a walk out with ..", () => {
    const r = planExec(root, "node", ["../elsewhere/secret.txt"], ok);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rule).toBe("confinement");
  });

  it("refuses an absolute path outside the project", () => {
    const r = planExec(root, "node", [join(outside, "secret.txt")], ok);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rule).toBe("confinement");
  });

  // The one that string-matching always misses.
  it("refuses a SYMLINK that points out of the project", () => {
    const bridge = join(root, "innocent");
    symlinkSync(outside, bridge);
    const r = planExec(root, "node", ["innocent/secret.txt"], ok);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rule).toBe("confinement");
  });

  it("refuses a symlinked WORKING DIRECTORY that points out", () => {
    const bridge = join(root, "workdir");
    symlinkSync(outside, bridge);
    const r = planExec(root, "npm", ["install"], { ...ok, cwd: bridge });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rule).toBe("confinement");
  });

  it("refuses a ~ path, which is neither absolute nor contains ..", () => {
    const r = planExec(root, "node", ["~/.ssh/id_rsa"], ok);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["deny", "confinement"]).toContain(r.rule);
  });

  it("is not fooled by a sibling whose name starts the same", () => {
    // /base/project  vs  /base/project-evil — a prefix match would let this through
    const evil = `${realpathSync(root)}-evil`;
    mkdirSync(evil, { recursive: true });
    try {
      expect(isWithin(root, evil)).toBe(false);
      expect(planExec(root, "npm", ["install"], { ...ok, cwd: evil }).ok).toBe(false);
    } finally { rmSync(evil, { recursive: true, force: true }); }
  });

  it("still resolves through a symlink for a path that does not exist yet", () => {
    const bridge = join(root, "future");
    symlinkSync(outside, bridge);
    // nothing named new.txt exists; the check must still see through `future`
    expect(trueLocation(join(bridge, "new.txt"))).toBe(join(realpathSync(outside), "new.txt"));
  });
});

describe("the deny list", () => {
  it("names the money rig and SAM's own source and secrets", () => {
    const list = [
      join(homedir(), "flip-it"),
      join(homedir(), "sam"),
      join(homedir(), ".ssh"),
      join(homedir(), "sam-signing"),
    ];
    for (const p of list) expect(hitsDenyList(p)).not.toBeNull();
  });

  it("refuses the rig even as a project root — the yard never works in there", () => {
    const r = planExec(join(homedir(), "flip-it"), "git", ["status"], ok);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.rule).toBe("deny"); expect(r.reason).toMatch(/flip-it/); }
  });

  it("refuses a path INTO the rig from a legitimate project", () => {
    const r = planExec(root, "node", [join(homedir(), "flip-it", "state", "ladder.json")], ok);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rule).toBe("deny");
  });

  it("leaves an ordinary directory alone", () => {
    expect(hitsDenyList(root)).toBeNull();
  });
});

describe("what an argument counts as a path", () => {
  it("treats flags as flags", () => {
    expect(looksLikePath("--save-dev")).toBe(false);
    expect(looksLikePath("-y")).toBe(false);
    expect(looksLikePath("install")).toBe(false);
    expect(looksLikePath("left-pad")).toBe(false);
  });
  it("treats anything path-shaped as a path", () => {
    expect(looksLikePath("/etc/passwd")).toBe(true);
    expect(looksLikePath("src/index.ts")).toBe(true);
    expect(looksLikePath("~/.ssh")).toBe(true);
    expect(looksLikePath("..")).toBe(true);
  });
});

describe("the child's environment", () => {
  it("carries only a short whitelist, with HOME in a sandbox beside the project", () => {
    const env = childEnv(root);
    expect(env.HOME).not.toBe(root);              // not the project — see "the child's HOME"
    expect(env.HOME).toContain(".home");
    expect(Object.keys(env).sort()).toEqual([
      "CI", "HOME", "LANG", "NODE_ENV", "PATH", "TMPDIR",
      "npm_config_audit", "npm_config_fund", "npm_config_update_notifier",
    ].sort());
  });

  it("carries no key from the parent, whatever the parent holds", () => {
    process.env.GROQ_API_KEY = "gsk_definitely_not_for_children";
    process.env.OPENAI_API_KEY = "sk-nope";
    try {
      const values = Object.values(childEnv(root)).join(" ");
      expect(values).not.toMatch(/gsk_definitely_not_for_children/);
      expect(values).not.toMatch(/sk-nope/);
      expect(Object.keys(childEnv(root))).not.toContain("GROQ_API_KEY");
    } finally {
      delete process.env.GROQ_API_KEY; delete process.env.OPENAI_API_KEY;
    }
  });

  it("accepts explicit per-job values", () => {
    expect(childEnv(root, { MY_FLAG: "1" }).MY_FLAG).toBe("1");
  });

  it("refuses the environment variables that would subvert the child", () => {
    const env = childEnv(root, { LD_PRELOAD: "/tmp/evil.so", DYLD_INSERT_LIBRARIES: "/tmp/evil.dylib", NODE_OPTIONS: "--require /tmp/evil.js", PATH: "/tmp/evil", HOME: "/" });
    expect(env.LD_PRELOAD).toBeUndefined();
    expect(env.DYLD_INSERT_LIBRARIES).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.HOME).not.toBe("/");                // an injected HOME never wins
    expect(env.PATH).not.toBe("/tmp/evil");
  });

  it("ignores oddly-named injected variables rather than trusting them", () => {
    const env = childEnv(root, { "not a name": "x", lowercase: "y" } as any);
    expect(env["not a name"]).toBeUndefined();
    expect(env.lowercase).toBeUndefined();
  });
});

describe("actually running something", () => {
  it("runs an allowed command in the project and returns its output", async () => {
    const r = await execInProject(root, "node", ["--version"], { handshake: true });
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toMatch(/^v\d+\./);
  });

  it("gives back a non-zero exit as a result, not an exception", async () => {
    const r = await execInProject(root, "node", ["-e", "process.exit(3)"], { handshake: true });
    expect(r.code).toBe(3);
  });

  it("throws a refusal rather than returning it as output", async () => {
    await expect(execInProject(root, "bash", ["-c", "echo hi"], { handshake: true })).rejects.toThrow(ExecRefused);
    await expect(execInProject(root, "npm", ["install"], { handshake: false })).rejects.toThrow(/not switched on/);
  });

  it("proves at runtime that a child cannot see the vault", async () => {
    process.env.GROQ_API_KEY = "gsk_runtime_leak_canary";
    try {
      const r = await execInProject(root, "node", ["-e", "console.log(JSON.stringify(process.env))"], { handshake: true });
      expect(r.code).toBe(0);
      expect(r.stdout).not.toMatch(/gsk_runtime_leak_canary/);
      expect(r.stdout).not.toMatch(/GROQ_API_KEY/);
      expect(JSON.parse(r.stdout).HOME).toContain(".home");   // the sandbox, not the project
    } finally { delete process.env.GROQ_API_KEY; }
  });
});

describe("writing a file the yard decided on", () => {
  it("writes inside the project, creating folders as needed", async () => {
    const { writeInProject } = await import("./exec.ts");
    const at = writeInProject(root, "src/pages/index.html", "<h1>hi</h1>");
    expect(existsSync(at)).toBe(true);
    expect(readFileSync(at, "utf8")).toBe("<h1>hi</h1>");
  });

  it("refuses a path that climbs out", async () => {
    const { writeInProject } = await import("./exec.ts");
    expect(() => writeInProject(root, "../elsewhere/pwned.txt", "x")).toThrow(/outside the project/);
    expect(existsSync(join(outside, "pwned.txt"))).toBe(false);
  });

  it("refuses an absolute path or a home path outright", async () => {
    const { writeInProject } = await import("./exec.ts");
    expect(() => writeInProject(root, join(outside, "x.txt"), "x")).toThrow(/relative path/);
    expect(() => writeInProject(root, "~/.ssh/authorized_keys", "x")).toThrow(/relative path/);
  });

  it("refuses to follow a symlink out of the project", async () => {
    const { writeInProject } = await import("./exec.ts");
    symlinkSync(outside, join(root, "bridge"));
    expect(() => writeInProject(root, "bridge/pwned.txt", "x")).toThrow(/outside the project/);
    expect(existsSync(join(outside, "pwned.txt"))).toBe(false);
  });

  it("refuses to write into the project's own git directory", async () => {
    const { writeInProject } = await import("./exec.ts");
    mkdirSync(join(root, ".git"), { recursive: true });
    // rewriting .git would rewrite history — and history is where every way back lives
    expect(() => writeInProject(root, ".git/config", "[remote]")).toThrow(/git directory is not writable/);
    expect(() => writeInProject(root, ".git/hooks/pre-commit", "#!/bin/sh")).toThrow(/git directory is not writable/);
  });

  it("refuses an empty path rather than writing somewhere surprising", async () => {
    const { writeInProject } = await import("./exec.ts");
    expect(() => writeInProject(root, "", "x")).toThrow(/no file path/);
  });
});

describe("the limits that were set but never exercised", () => {
  it("stops a command that runs too long, rather than holding the worker for ever", async () => {
    const started = Date.now();
    const r = await execInProject(root, "node", ["-e", "setTimeout(()=>{}, 60000)"], { handshake: true, timeoutMs: 1500 });
    expect(Date.now() - started).toBeLessThan(15_000);   // it did NOT wait the full minute
    expect(r.code).not.toBe(0);                          // and it is reported as a failure
  });

  it("caps runaway output instead of taking the process down with it", async () => {
    // ~4MB, well past the 512KB cap: the danger is an out-of-memory, not a big string
    const r = await execInProject(root, "node", ["-e", "process.stdout.write('x'.repeat(4*1024*1024))"], { handshake: true });
    expect(r.stdout.length).toBeLessThanOrEqual(512 * 1024);
    expect(r.truncated).toBe(true);                      // and it SAYS it was cut, never silently
  });

  it("reports a command that does not exist as a failure, not a crash", async () => {
    // on the allowlist, but not installed on every machine
    const r = await execInProject(root, "wrangler", ["--version"], { handshake: true });
    expect(typeof r.code).toBe("number");
    expect(r.code).not.toBe(0);
  });
});

describe("the deploy credential is scoped to deploy work only", () => {
  // The token controls a whole hosting account, so it is the most sensitive thing the
  // yard holds. Every OTHER job must be blind to it — not by convention, by construction.
  const CANARY = "vcp_deploycanary0123456789abcdef";

  it("an ordinary job cannot see it, even though the parent process can", async () => {
    process.env.VERCEL_TOKEN = CANARY;
    try {
      const r = await execInProject(root, "node", ["-e", "console.log(JSON.stringify(process.env))"], { handshake: true });
      expect(r.stdout).not.toContain(CANARY);
      expect(r.stdout).not.toContain("VERCEL_TOKEN");
    } finally { delete process.env.VERCEL_TOKEN; }
  });

  it("is absent from the whitelist a normal job is built from", () => {
    process.env.VERCEL_TOKEN = CANARY;
    try {
      expect(Object.keys(childEnv(root))).not.toContain("VERCEL_TOKEN");
      expect(Object.values(childEnv(root)).join(" ")).not.toContain(CANARY);
    } finally { delete process.env.VERCEL_TOKEN; }
  });

  it("reaches a deploy job ONLY because that job passes it explicitly", async () => {
    // NB: written without shell punctuation, because the executor refuses arguments
    // carrying it — as this test found out the first time it was written.
    const r = await execInProject(root, "node", ["-e", "console.log(String(process.env.VERCEL_TOKEN))"], {
      handshake: true, env: { VERCEL_TOKEN: CANARY },
    });
    expect(r.stdout.trim()).toBe(CANARY);   // the deploy path, and only it, gets the token
  });

  it("never appears in a job's log, because the log is scrubbed on the way in", async () => {
    const { scrub } = await import("../scrub.ts");
    process.env.VERCEL_TOKEN = CANARY;
    try {
      const line = scrub(`deploying with token ${CANARY} now`);
      expect(line).not.toContain(CANARY);
      // Redacted by REFERENCE (SAM holds this value) before the shape pass can see it,
      // so the kept prefix is 3 chars rather than 4. Either way the secret is gone and
      // the log still says what kind of thing was there.
      expect(line).toMatch(/vcp_?\[redacted\]/);
      expect(line).toContain("deploying with token");
    } finally { delete process.env.VERCEL_TOKEN; }
  });
});

describe("finding the tools a build needs", () => {
  // A launchd- or GUI-started process inherits PATH=/usr/bin:/bin:/usr/sbin:/sbin. A
  // perfectly-installed vercel is then invisible and the deploy dies with a bare ENOENT.
  it("adds the usual install locations to a minimal inherited PATH", async () => {
    const { toolPath } = await import("./exec.ts");
    const p = toolPath({ PATH: "/usr/bin:/bin:/usr/sbin:/sbin" } as any);
    expect(p).toContain("/opt/homebrew/bin");
    expect(p).toContain("/usr/local/bin");
    expect(p).toContain("/usr/bin");
  });

  it("keeps what was inherited, and keeps it first", async () => {
    const { toolPath } = await import("./exec.ts");
    expect(toolPath({ PATH: "/my/tools:/usr/bin" } as any).startsWith("/my/tools:/usr/bin")).toBe(true);
  });

  it("never repeats an entry", async () => {
    const { toolPath } = await import("./exec.ts");
    const parts = toolPath({ PATH: "/usr/bin:/opt/homebrew/bin" } as any).split(":");
    expect(parts.length).toBe(new Set(parts).size);
  });

  it("still works when PATH is missing entirely", async () => {
    const { toolPath } = await import("./exec.ts");
    expect(toolPath({} as any)).toContain("/usr/bin");
  });
});

describe("the child's HOME", () => {
  // Pointing HOME at the project made a deploy hang for ever: the tool saw cwd === HOME
  // and asked "you are deploying your home directory, continue?" — a question --yes does
  // not answer, with no terminal to answer it.
  it("is beside the project, never the project itself", async () => {
    const { childEnv } = await import("./exec.ts");
    const home = childEnv(root).HOME;
    expect(home).not.toBe(root);
    expect(existsSync(home)).toBe(true);
  });

  it("stays outside the project, so it is never published or committed", async () => {
    const { childEnv, isWithin } = await import("./exec.ts");
    expect(isWithin(root, childEnv(root).HOME)).toBe(false);
  });

  it("still hides the real home — the whole point of the scrub", async () => {
    const { childEnv } = await import("./exec.ts");
    const home = childEnv(root).HOME;
    expect(home).not.toBe(homedir());
    expect(home.startsWith(homedir())).toBe(false);
  });
});

describe("running on Windows", () => {
  // The yard has only ever run on this Mac, but SAM ships Windows installers. These pin
  // the two things that actually break there: the PATH separator, and that npm/npx are
  // .cmd shims execFile cannot resolve without a shell (and turning the shell on would
  // reopen the injection the whole executor exists to prevent).
  const winEnv = { PATH: "C:\\Windows\\System32;C:\\Program Files\\nodejs", APPDATA: "C:\\Users\\x\\AppData\\Roaming", PATHEXT: ".COM;.EXE;.BAT;.CMD" } as any;

  it("joins PATH with a semicolon, not a colon", async () => {
    const { toolPath } = await import("./exec.ts");
    const p = toolPath(winEnv, "win32");
    expect(p).toContain(";");
    expect(p.split(";")).toContain("C:\\Windows\\System32");
    expect(p).toContain("C:\\Users\\x\\AppData\\Roaming\\npm");   // npm global prefix
  });

  it("still uses a colon and unix dirs on mac", async () => {
    const { toolPath } = await import("./exec.ts");
    const p = toolPath({ PATH: "/usr/bin" } as any, "darwin");
    expect(p).toContain(":");
    expect(p).toContain("/opt/homebrew/bin");
    expect(p).not.toContain(";");
  });

  it("resolves a bare command to its .cmd shim on Windows", async () => {
    const { resolveCommand } = await import("./exec.ts");
    // pretend only npm.cmd exists on disk
    // Windows filesystem is case-insensitive; PATHEXT is upper, files are lower
    const exists = (p: string) => p.toLowerCase() === "c:\\program files\\nodejs\\npm.cmd";
    expect(resolveCommand("npm", winEnv, "win32", exists).toLowerCase()).toBe("c:\\program files\\nodejs\\npm.cmd");
  });

  it("resolves node.exe over a bare name", async () => {
    const { resolveCommand } = await import("./exec.ts");
    const exists = (p: string) => p.toLowerCase() === "c:\\program files\\nodejs\\node.exe";
    expect(resolveCommand("node", winEnv, "win32", exists).toLowerCase()).toBe("c:\\program files\\nodejs\\node.exe");
  });

  it("leaves the name alone on unix — the OS resolves it", async () => {
    const { resolveCommand } = await import("./exec.ts");
    expect(resolveCommand("npm", { PATH: "/usr/bin" } as any, "darwin")).toBe("npm");
  });

  it("returns the bare name when nothing matches, so execFile fails honestly", async () => {
    const { resolveCommand } = await import("./exec.ts");
    expect(resolveCommand("nope", winEnv, "win32", () => false)).toBe("nope");
  });

  it("denies the Windows user-profile locations too", async () => {
    // deny list is built with path.join, so it is already correct per-platform; this just
    // proves the Windows-sensitive entries are present
    const { denyList } = await import("./exec.ts");
    const joined = denyList().join(" ");
    expect(joined).toMatch(/AppData/);
    expect(joined).toMatch(/\.ssh/);
  });
});
