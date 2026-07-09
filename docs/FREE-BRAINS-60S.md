# Free brains in 60 seconds

SAM works **free out of the box** — nothing to sign up for. Adding a free key or two just makes it
faster and unlocks photos & voice. The in-app wizard does this in about a minute.

## The wizard (easiest)

1. Open SAM → click **🔑** at the top (or **⚙ Settings → ⚡ Power up**).
2. For any provider, click **Get free key ↗** — it opens that provider's key page.
3. Sign in, create a key, copy it. SAM's **clipboard watcher** notices and offers to slot it in — or just paste it.
4. SAM **validates it live** (a real test call) and shows a green **✓ online**. The progress meter fills as you add brains.

That's it. SAM pools every key you add and rotates across them, so you basically never hit a limit.

## The four fastest free brains

| Provider | Get your key | Why | Key looks like |
|---|---|---|---|
| **Groq** | [console.groq.com/keys](https://console.groq.com/keys) | fastest inference anywhere, ~30-sec signup | `gsk_…` |
| **Google Gemini** | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | adds **photos & vision** | `AIza…` |
| **OpenRouter** | [openrouter.ai/keys](https://openrouter.ai/keys) | 300+ models behind one key | `sk-or-…` |
| **Mistral** | [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys) | strong models, generous free tier | 32 chars |

## No key at all?

Totally fine — SAM runs on **free no-key cloud brains**, and if you install
[Ollama](https://ollama.com) it runs a **100% private, offline brain** on your own machine (no keys,
ever). The wizard is a pure upgrade, never a gate.

## Where keys live

In your local `.env` only. Never logged, never synced, never sent anywhere except the provider you're
using. You can re-open the wizard any time from **⚙ Settings → ⚡ Power up**.

> *(Screen recordings of each provider flow are generated per release by the demo pipeline — see `docs/launch/`.)*
