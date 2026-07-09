# X / Twitter thread draft (10 tweets)

1/ I built SAM: a free, private AI assistant that lives on your own machine and actually *does the work*
— not another chat box. One paste to install. 🧵

2/ The hook: `curl -fsSL https://richhabits.github.io/sam/install.sh | bash`
(Windows: `irm …/install.ps1 | iex`). It verifies the SHA-256 and launches. ~60 seconds → working
assistant, zero keys needed.

3/ It's a doer. 167 real tools: web, files, terminal, email, calendar, GitHub (commit/push/PRs), camera
+ vision. It doesn't tell you how — it does it.

4/ Big job? SAM assembles a *team* of specialist agents that work in parallel and hand you one answer.
Research + code + writing + strategy, at once.

5/ Free + private by default. Runs on ~40 auto-rotating free AI tiers so it never rate-limits itself —
or 100% offline on Ollama, where nothing ever leaves your machine.

6/ No keys? With Ollama installed it uses your *local* model by default. Private, offline, instant. Cloud
is just the fallback.

7/ Want more speed/photos/voice? A 60-second wizard adds free keys (Groq/Gemini/OpenRouter/Mistral) —
deep-links, live validation, done. Never a gate; SAM works free out of the box.

8/ Safe by design: dangerous actions (shell, send, delete, push) always ask first — even in autopilot.
Web/email content is fenced so prompt-injection can't fire tools.

9/ Honest bits: desktop builds are unsigned for now (cert incoming) — checksums included, click-through
documented. Zero telemetry. Your data is yours.

10/ It's free, forever, by @HECTIC. Star it, break it, tell me what's missing 👇
https://github.com/richhabits/sam
