# X / Twitter thread draft (10 tweets)

1/ What Cursor did for coding, I built for the whole computer. SAM: a free, private AI that lives on your Mac, knows your files, and *does the work* — now ~86% cheaper and ~46% faster than its last version. 🧵

2/ The trick is a cascade router. Every request is classified in ~0ms: "hi" and quick rewrites go to your LOCAL model (never a paid API), normal stuff to free cloud tiers, hard stuff to the strong free lane. Premium only if you opt in.

3/ Result on a fixed 20-task benchmark: 100% served free-or-local, avg cost/task down 86%, latency down 46%. It's in the repo and runs against a deterministic mock — reproduce it yourself for $0: `npm run bench`.

4/ Ask the same thing twice? A semantic cache answers in ~2ms, 0 tokens, "from memory". Repeat work is basically free.

5/ It knows YOUR stuff. Point it at folders and it indexes them on-device, keeps them fresh, and cites the file in its answers. Cursor indexes your repo; SAM indexes your world.

6/ ⌥Space over ANY app → highlight text → rewrite / reply / summarize / translate / fix it in place. AI inside whatever you're doing, not in a separate tab.

7/ When SAM lacks a tool, it writes one — a function it static-scans (no eval/shell), sandbox-tests, and saves DISABLED for you to review. Nothing risky runs without you.

8/ Private by design: keys, memory, files, vault stay local; nothing leaves in offline mode; zero telemetry. Optional passphrase encryption at rest. Dangerous actions always ask first.

9/ Honest bits: desktop builds are unsigned for now (checksums published); at-rest encryption is opt-in. All in the open — it's MIT-licensed now.

10/ Free, forever, by @HECTIC. Star it, break it, tell me what's missing 👇
https://github.com/richhabits/sam
