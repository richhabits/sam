# 🧠 Free Brains — get SAM running on free AI (10–60 min, then never pay)

**The deal:** SAM runs on other companies' **free** AI tiers. Each provider gives you a free
API key. SAM **rotates across all the keys you add** — when one hits its daily limit, it hops to
the next without you noticing. So the more providers you set up, the more free AI you have.

> **Put in an hour once → save thousands.** Paid AI (ChatGPT Plus, Claude Pro, API bills) runs
> £20–£200+/month. The 7 free keys below take about **15 minutes total** and cover normal daily
> use for free, forever. Add the bonus ones and you've got serious free headroom.
>
> Don't want to bother? That's fine — **SAM still works with ZERO keys** using local Ollama
> (see the bottom). But 15 minutes of copy-paste is the difference between "slow local only"
> and "fast, unlimited-feeling, free." Your call.

---

## 🪪 Step 0 — give SAM its own identity (do this once, first)

The trick that makes the rest painless: **one email + one password for everything SAM signs up to.**
You create these — SAM never signs up on its own (that breaks providers' rules and gets accounts
banned). You stay in control; SAM just uses the keys you paste in.

1. **Make SAM an email** — e.g. a free Gmail like `yourname.sam@gmail.com`, or `sam@yourdomain.com`.
   This becomes SAM's identity for every free account below.
2. **Pick ONE strong password** for it — call it SAM's password. Write it in a password manager
   (iCloud Keychain, 1Password, Bitpass…) so you never retype it.
3. From now on, every provider signup below uses **that same email + that same password** (or its
   "Sign in with Google" button, using SAM's Gmail). One identity, reused everywhere = 2 clicks each.

> **Why one identity:** you'll have ~10 logins. Same email + password (in your password manager)
> turns each signup into "click Google → done." And when SAM emails you the morning brief, it's
> coming from this same address (set it up under **⚙ Settings → 📧 SAM's email**).

---

## How it works (10-second version)

1. Click a link below → sign in **with SAM's email/password (Step 0)** → copy the key it gives you.
2. In SAM: **⚙ Settings → API keys** → paste it → **Save**.
3. Repeat for as many as you like. **More providers = more free capacity.** That's it.

SAM even tells you when you're running low and which one to add next (the **capacity** monitor).

---

## ⭐ The starter 7 (do these first — fast, generous, easy)

Each is one free account, one key. Paste each into **Settings → API keys**.

| # | Provider | Get your key | Why | ~time |
|---|----------|-------------|-----|-------|
| 1 | **Groq** | **[console.groq.com/keys](https://console.groq.com/keys)** | Fastest replies, very generous free tier | 2 min |
| 2 | **Cerebras** | **[cloud.cerebras.ai](https://cloud.cerebras.ai)** | Blazing fast, big 70B model | 2 min |
| 3 | **Google Gemini** | **[aistudio.google.com/apikey](https://aistudio.google.com/apikey)** | Adds **photos/vision** + generous free | 2 min |
| 4 | **OpenRouter** | **[openrouter.ai/keys](https://openrouter.ai/keys)** | Many free models behind **one** key | 2 min |
| 5 | **NVIDIA** | **[build.nvidia.com](https://build.nvidia.com)** | Capable 70B, generous | 3 min |
| 6 | **Mistral** | **[console.mistral.ai/api-keys](https://console.mistral.ai/api-keys)** | Solid European models, free tier | 3 min |
| 7 | **GitHub Models** | **[github.com/settings/tokens](https://github.com/settings/tokens)** | Free with a GitHub token (any scope) | 2 min |

**Do all 7 and SAM basically never runs out for normal personal use.** Total: ~15 minutes.

### Baby steps for #1 (Groq) — the rest follow the same pattern
1. Click **[console.groq.com/keys](https://console.groq.com/keys)**.
2. Sign up / sign in **with SAM's email + password from Step 0** (or the "Sign in with Google"
   button using SAM's Gmail — fastest). Your password manager fills it in.
3. Click **"Create API Key"**, give it any name, click create.
4. **Copy** the key it shows you (starts with `gsk_...`). Copy it *now* — some sites only show it once.
5. In SAM: **⚙ Settings → API keys**, find **Groq**, paste, **Save**.
6. Done. Repeat 2–7 — same email, same password each time. 🎉

---

## 🚀 Bonus brains (optional — even more free headroom)

Same routine — sign in, copy key, paste in Settings. Add any you fancy:

| Provider | Get your key |
|----------|-------------|
| **Together AI** | [api.together.xyz/settings/api-keys](https://api.together.xyz/settings/api-keys) |
| **SambaNova** | [cloud.sambanova.ai](https://cloud.sambanova.ai) |
| **DeepSeek** | [platform.deepseek.com/api_keys](https://platform.deepseek.com/api_keys) |
| **Fireworks** | [fireworks.ai/api-keys](https://fireworks.ai/api-keys) |
| **Cohere** | [dashboard.cohere.com/api-keys](https://dashboard.cohere.com/api-keys) |
| **Hyperbolic** | [app.hyperbolic.xyz/settings](https://app.hyperbolic.xyz/settings) |

SAM supports **30+ providers** in total — you never need all of them, but each one you add is more free rotation.

---

## 💡 The honest bit (so you don't get burned)

- **You sign up, not a bot.** Use SAM's email + password (Step 0) to create each account **yourself**
  — the same way you'd sign up for anything. Automating account creation (a script/bot that farms
  signups) breaks every provider's rules and gets the accounts **banned**, so SAM never does it. You
  click, SAM uses the keys.
- **One account per provider.** SAM's power is spreading across *many* providers, not making
  fake accounts on one. Breadth (10 providers, one login each) beats abuse (10 fake Groq accounts) —
  and lasts forever.
- **It's genuinely free.** These are the providers' own free tiers. Nothing bills you unless *you*
  deliberately add a paid provider (OpenAI/Anthropic) and pick it.
- **Your keys stay on your machine** (`.env`), never uploaded. SAM never shows them back.
- **SAM's email can do more than keys.** Once SAM has its own inbox, that same identity is what you
  use to sign it up for anything else you want it to have (newsletters, dev tools, a GitHub account of
  its own…). Same rule: **you** do the signup with SAM's email + password; SAM then uses the access.

---

## 🆓 Zero effort option: local Ollama (no keys at all)

Don't want any keys? SAM runs **100% offline and unlimited** on your own machine:

1. Install **[Ollama](https://ollama.com)** (one download).
2. In Terminal: `ollama pull llama3.2:3b`
3. Start SAM. That's it — it uses local Ollama automatically when no cloud key is free.

Local is slower and a bit less clever than the cloud brains, but it's **truly unlimited and private**,
and it's always there as SAM's backstop even after you add the free keys above.

---

**TL;DR:** 15 minutes of copy-paste (the starter 7) = fast, free AI that basically never runs out.
Or add nothing and run local. Either way you never pay us — SAM is free. 🖤
