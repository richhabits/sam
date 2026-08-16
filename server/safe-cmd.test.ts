import { describe, it, expect } from "vitest";
import { isReadOnlyCommand } from "./tools.ts";

// These tests verify the ACTUAL classification logic, not just that the function exists.
// Every test case was chosen because it represents a real command SAM would use or a real
// attack vector that MUST be blocked.

describe("isReadOnlyCommand — commands that SHOULD auto-run", () => {
  const safeCommands = [
    // Basic reads
    "ls -la /Volumes/ROMEO\\ HQ/SAM/server",
    "cat package.json",
    "head -20 server/agent.ts",
    "tail -f vault/daemons/latest.log",
    "wc -l server/*.ts",
    "file server/index.ts",

    // Git reads — the most common SAM commands
    "git status",
    "git log --oneline -10",
    "git diff --stat HEAD",
    "git branch -a",
    "git show HEAD:server/models.ts",
    "git log --oneline origin/main..HEAD",

    // Build verification (read-only)
    "npx tsc --noEmit",
    "npx vitest run server/wallet.test.ts",
    "node -e 'console.log(process.version)'",
    "npm ls --depth=0",
    "npm outdated",

    // Search
    "grep -rn 'findByContent' server/",
    "rg -il 'TODO' server/",

    // Pipelines of safe commands
    "git log --oneline | head -5",
    "ls server/*.ts | wc -l",
    "cat package.json | grep version",
    "git diff --stat | grep tools",

    // System info
    "echo hello",
    "date",
    "uname -a",
    "whoami",
    "which node",
    "env | grep PATH",

    // With env var prefixes
    "PATH=/usr/bin git status",
    "NODE_ENV=test npx vitest run",

    // Absolute paths to binaries
    "/usr/bin/git status",
    "/usr/bin/env node -v",

    // Network reads
    "curl https://example.com",
    "dig google.com",
    "ping -c 1 google.com",

    // Process inspection
    "ps aux",
    "lsof -i :7777",
    "pgrep -l node",

    // Diff
    "diff server/a.ts server/b.ts",
  ];

  for (const cmd of safeCommands) {
    it(`allows: ${cmd.slice(0, 60)}`, () => {
      expect(isReadOnlyCommand(cmd)).toBe(true);
    });
  }
});

describe("isReadOnlyCommand — commands that MUST be blocked", () => {
  const dangerousCommands = [
    // Destructive filesystem
    "rm -rf node_modules",
    "rm server/tools.ts",
    "mkdir -p /tmp/exploit",
    "touch /tmp/marker",
    "mv server/old.ts server/new.ts",
    "cp -r server/ /tmp/backup",

    // Permission changes
    "chmod 777 server/index.ts",
    "chown root server/index.ts",

    // Privilege escalation
    "sudo ls /root",
    "sudo cat /etc/shadow",

    // Git mutations — the distinction that matters
    "git push",
    "git push origin main",
    "git commit -m 'oops'",
    "git merge feature",
    "git rebase main",
    "git reset --hard HEAD~1",
    "git checkout -b new-branch",
    "git stash",
    "git cherry-pick abc123",
    "git revert HEAD",
    "git clean -fd",
    "git branch -D feature",

    // npm mutations
    "npm install express",
    "npm uninstall lodash",
    "npm publish",
    "npm ci",
    "npm link",

    // Kill processes
    "kill -9 1234",
    "killall node",

    // Mutating HTTP
    "curl -X POST https://api.example.com/data",
    "curl --data '{\"key\":\"val\"}' https://api.example.com",
    "curl -X DELETE https://api.example.com/resource/1",
    "wget -O /tmp/file https://example.com/binary",

    // Output redirection (writes to file)
    "echo pwned > /tmp/exploit.sh",
    "cat file.txt > /tmp/copy.txt",
    "ls > /tmp/listing.txt",

    // System destructive
    "shutdown -h now",
    "reboot",
    "diskutil erase /dev/disk2",

    // Dangerous behind a pipeline — a safe first command piped to a dangerous one
    // (these have unsafe patterns anywhere in the string)
    "cat /etc/passwd | sudo tee /tmp/stolen",

    // npx scaffolding
    "npx create-react-app my-app",
    "npx prisma migrate deploy",
  ];

  for (const cmd of dangerousCommands) {
    it(`blocks: ${cmd.slice(0, 60)}`, () => {
      expect(isReadOnlyCommand(cmd)).toBe(false);
    });
  }
});

describe("isReadOnlyCommand — edge cases and bypass attempts", () => {
  it("blocks an unknown binary even without destructive patterns", () => {
    // A binary not in the safe set should be rejected
    expect(isReadOnlyCommand("my_script.sh --flag")).toBe(false);
    expect(isReadOnlyCommand("/usr/local/bin/custom_tool arg")).toBe(false);
  });

  it("blocks empty commands", () => {
    expect(isReadOnlyCommand("")).toBe(false);
  });

  it("blocks semicolons sneaking a second command through a pipeline split", () => {
    // The pipe splitter won't catch semicolons — the unknown command after ; fails the allowlist
    expect(isReadOnlyCommand("ls; rm -rf /")).toBe(false);
  });

  it("blocks && chaining with destructive second command", () => {
    // "ls && rm file" — rm matches UNSAFE_PATTERNS
    expect(isReadOnlyCommand("ls && rm file")).toBe(false);
  });

  it("git read operations pass, git writes fail — this is the critical boundary", () => {
    expect(isReadOnlyCommand("git status")).toBe(true);
    expect(isReadOnlyCommand("git log")).toBe(true);
    expect(isReadOnlyCommand("git diff")).toBe(true);
    expect(isReadOnlyCommand("git show HEAD")).toBe(true);
    expect(isReadOnlyCommand("git blame server/tools.ts")).toBe(true);

    expect(isReadOnlyCommand("git push")).toBe(false);
    expect(isReadOnlyCommand("git commit -m 'x'")).toBe(false);
    expect(isReadOnlyCommand("git reset --hard")).toBe(false);
  });

  // AUDIT FIX (found reviewing the version that shipped these 87 tests, before it was pushed):
  // every case above passed for real, but four real exploits also returned `true` and nothing
  // here caught them. "blocks semicolons sneaking a second command" (above) used `rm -rf /`
  // after the `;` — which passes because UNSAFE_PATTERNS matches "rm -rf" as a substring
  // ANYWHERE in the raw string, not because anything actually inspected the post-`;` segment.
  // A command with no rm/mv/chmod/etc. after the separator sailed straight through. These
  // cases use commands with nothing UNSAFE_PATTERNS would ever match, so they only pass if the
  // segment-splitting itself is doing the real work.
  it("blocks a semicolon-chained command with nothing in UNSAFE_PATTERNS to catch it by luck", () => {
    expect(isReadOnlyCommand("ls ; base64 ~/.ssh/id_rsa")).toBe(false);
    expect(isReadOnlyCommand("ls;base64 ~/.ssh/id_rsa")).toBe(false);
  });

  it("blocks && and & chained commands the same way, not just pipes", () => {
    expect(isReadOnlyCommand("ls && cat ~/.env")).toBe(false);
    expect(isReadOnlyCommand("ls & cat ~/.ssh/id_rsa")).toBe(false);
    expect(isReadOnlyCommand("git status || base64 ~/.aws/credentials")).toBe(false);
  });

  it("blocks command/process substitution outright — the shell evaluates it before anything else runs", () => {
    expect(isReadOnlyCommand("echo $(cat ~/.ssh/id_rsa)")).toBe(false);
    expect(isReadOnlyCommand("echo `cat ~/.ssh/id_rsa`")).toBe(false);
    expect(isReadOnlyCommand("diff <(cat ~/.env) /dev/null")).toBe(false);
  });

  it("blocks a newline-sequenced second command, same as ; would be", () => {
    expect(isReadOnlyCommand("ls\nbase64 ~/.ssh/id_rsa")).toBe(false);
    expect(isReadOnlyCommand("git status\nnpm install left-pad")).toBe(false);
  });

  it("blocks a direct read of a credential path with NO chaining trick needed at all", () => {
    // cat/head/tail/grep were unconditionally in the allowlist with zero credential-path
    // awareness — this is the one that mattered most: no bypass required, just the tool
    // working exactly as documented against a private key.
    expect(isReadOnlyCommand("cat ~/.ssh/id_rsa")).toBe(false);
    expect(isReadOnlyCommand("head -50 ~/.aws/credentials")).toBe(false);
    expect(isReadOnlyCommand("grep -r password ~/.ssh/")).toBe(false);
    expect(isReadOnlyCommand("cat .env")).toBe(false);
    expect(isReadOnlyCommand("tail ~/.npmrc")).toBe(false);
    // Sanity: cat on a NON-credential path must still work — this isn't "never cat anything".
    expect(isReadOnlyCommand("cat package.json")).toBe(true);
  });
});
