# SAM — Troubleshooting

The top things that go wrong, and the exact fix. **In the app, Settings → "SAM isn't working" runs these
checks automatically and tells you which one it is.** This doc is the same content, so search engines find
it too.

## "SAM isn't responding / nothing happens"

Almost always: **no AI brain is connected.**
- **Fastest fix:** Settings → **Power up (add free keys)** — a 60-second wizard, still free.
- **Fully offline:** install [Ollama](https://ollama.com), then `ollama pull llama3.2` and keep the Ollama
  app (or `ollama serve`) running. SAM will use it with no keys and nothing leaving your machine.

## macOS: "SAM is damaged and can't be opened"

Not real damage — it's the quarantine flag macOS puts on any downloaded app that isn't from the App Store.
The release is **signed + notarized**, so this shouldn't appear on the current build; if it does:
- Right-click the app → **Open** (once), **or**
- `xattr -cr /Applications/SAM.app` in Terminal, **or**
- System Settings → Privacy & Security → **Open Anyway**.

## Windows: "Windows protected your PC" / SmartScreen

Expected for any app still building download reputation. It's the same signed build CI tests.
- Browser flags the download → **Keep**.
- SmartScreen box → **More info → Run anyway**.

## The ⌥Space overlay doesn't appear (macOS)

It needs **Accessibility** permission (macOS can't grant it automatically):
- System Settings → **Privacy & Security → Accessibility** → turn **SAM** on.

## "Ollama is configured but not responding"

The local brain is set but Ollama isn't running:
- Open the **Ollama app**, or run `ollama serve` in a terminal.
- Make sure you've pulled a model: `ollama pull llama3.2`.

## Port 8787 is in use / two SAMs fighting

SAM's backend uses `127.0.0.1:8787`. If another copy is running (or a leftover process), quit it — SAM
won't start a second server on the same port. Restart SAM.

## "It's slow"

- On the **local** brain, speed depends on your machine + model size. Try a smaller model (`llama3.2:3b`).
- Add **free cloud keys** (Power up) so SAM can route quick/standard tasks to fast free tiers.

## Updating / rolling back

- SAM auto-updates. To force a check: Settings → **Check for updates**.
- If an update misbehaves: Settings → **Rollback** reinstalls the previous version; your data stays put.

## Still stuck?

- Run **Settings → "SAM isn't working"** first — it names the exact issue.
- Then **Settings → Copy diagnostic bundle** (redacted, local until you paste it) and open a
  [Question](https://github.com/richhabits/sam/issues/new/choose) — but the checks above resolve most things.
