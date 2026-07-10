# Build a tool for SAM

SAM does things through **tools**. A tool is a small typed object with a `run()` function. There are two
ways to add one — pick by whether you're extending your own install or shipping code for others.

## The Tool interface

```ts
export interface Tool {
  name: string;        // snake_case, unique — the model calls it by this
  safe: boolean;       // true = runs automatically · false = asks the user first (confirm-tier)
  description: string; // shown to the model — say what it does + the input shape, tightly
  params: string;      // a hint for the input shape, e.g. "{ url }" or "text"
  activity: (input: any) => string;   // plain-language "what SAM is doing" (shown live)
  preview?: (input: any) => string;   // optional richer confirmation preview
  run: (input: any) => Promise<string>;   // do the thing, return a string
}
```

### Permission tier — get this right
`safe` decides the tier, and the tier decides how it runs (see `SECURITY.md`):

- **safe** (`safe: true`) — read-only / harmless. Runs without asking.
- **confirm** (`safe: false`) — recoverable but notable (writes a file, commits). Asks by default.
- **dangerous** — outward-facing / destructive / security-altering (send, delete, shell, push, key/permission changes). **Always asks — no bypass.** A tool becomes dangerous by being listed in `server/authz.ts` `DANGEROUS`. If your tool sends, deletes, pushes, or runs code, add it there.

Mislabeling a dangerous tool as `safe` is the one mistake that matters. When unsure, set `safe: false`.

## Option A — a first-class tool (in the repo)

1. `npm run create-tool my_tool` — scaffolds a tool stub and prints where to wire it.
2. Implement `run()`. Keep it a pure async function that returns a string.
3. If it's dangerous, add `"my_tool"` to `DANGEROUS` in `server/authz.ts`.
4. Register it in the `TOOLS` array in `server/tools.ts`.
5. Add a test. `npm test`. Done.

Rules of the road: never interpolate user/model input into a shell string — use `execFile` with an args
array (no shell). Escape osascript/PowerShell string contexts. Return a helpful string on failure rather
than throwing.

## Option B — a forged tool (no repo, sandboxed)

Ask SAM: *"forge a tool that …"*. SAM drafts a JS function, **static-scans** it, runs it in a **separate
codegen-disabled process** (see `SECURITY.md` → the forge), and saves it **disabled** for you to review.
Forged tools declare capabilities up front — `net`, `fs:read`, `fs:write` — reached only through injected
`sam.*` shims; `net`/`fs:write` are automatically dangerous-tier; shell can never be forged.

Forge is the right choice for a personal one-off. Option A is right for something you'll ship in a pack.

## Testing a tool

```ts
import { TOOLS } from "./tools.ts";
const t = TOOLS.find(x => x.name === "my_tool")!;
expect(await t.run({ ... })).toContain("...");
```

Ship it in a pack → see [BUILD-A-PACK.md](BUILD-A-PACK.md).
