# X / Twitter thread draft (v1.6.0)

*Post the thread top-to-bottom; attach the demo GIF to tweet 1 (highest engagement) once it's recorded.*

1/ What Cursor did for coding, I built for the whole computer.

SAM: a free, private, MIT AI assistant that lives on your computer, knows your files, and *does the work* — web, files, terminal, email, GitHub. Runs on free tiers or fully offline on Ollama. 🧵

2/ The trick is a cascade router. Every request is classified in ~0ms: "hi" and quick rewrites go to your LOCAL model (never a paid API), normal stuff to free cloud tiers, hard stuff to the strong free lane. Premium only if you opt in.

3/ Result on a fixed 20-task benchmark: 100% served free-or-local, avg cost/task down ~86%, latency down ~46%.

It's in the repo and runs against a deterministic mock — reproduce it yourself for $0: `npm run bench`.

4/ Ask the same thing twice? A semantic cache answers in ~2ms, 0 tokens, "from memory." Repeat work is basically free.

5/ It knows YOUR stuff. Point it at folders → it indexes them on-device, keeps them fresh, and cites the source file in its answers. Cursor indexes your repo; SAM indexes your world.

6/ ⌥Space (or Alt+Space) over ANY app → highlight text → rewrite / reply / summarize / translate / fix it in place. AI inside whatever you're doing, not in a separate tab.

7/ When SAM lacks a tool, it writes one — drafts a JS function, static-scans it, runs it, saves it DISABLED for you to review. 173 tools ship in the box; forged ones extend it.

8/ Security story I'm not hiding: the forge originally ran tools in a `node:vm` sandbox. A pre-launch audit proved that's escapable — `constructor.constructor` reaches the host, → `process` → RCE. Node's own docs say vm isn't a security boundary.

9/ Fix: forged code now runs in a separate process with code-generation disabled isolate-wide, a stripped env (no keys), and no ambient globals. Found and fixed *before* launch, locked with regression tests. Write-up in the repo (`docs/SECURITY-AUDIT.md`).

10/ Private by design: keys, memory, files stay local; nothing leaves in offline mode; zero telemetry. Dangerous actions (shell/send/delete/push) always ask first. Signed + notarized desktop builds.

11/ Free, forever, MIT, by @HECTIC. Star it, break it, tell me what's missing 👇
https://github.com/richhabits/sam

---
*Notes: keep each tweet ≤280 chars (trim as needed). Tweets 8–9 (the honest RCE find) are the most
shareable — they can also stand alone as a quote-tweetable pair. Swap "@HECTIC" for the real handle.*
