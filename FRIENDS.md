# 👋 Hey — welcome to SAM

My mate built this. It's **your own private AI assistant** that runs on your computer — free.
Not just a chatbot: it actually *does* stuff (searches the web, reads your files, drafts emails,
and loads more) and it asks before anything risky.

---

## 🍎 On a Mac? The easy way — no terminal, nothing to install

1. **[⬇️ Download SAM here](https://github.com/richhabits/sam/releases/latest)** (click the `.dmg` file)
2. Open the downloaded file, drag **SAM** into your **Applications** folder
3. **Right-click** the SAM app → **Open** (do this the *first* time — the Mac asks "are you sure?", click **Open**)
4. That's it! SAM just works — no setup, no keys, nothing.

*(This is for Apple Silicon Macs — M1, M2, M3, M4. Most Macs from 2021 onwards.)*

---

## 🛠️ Or the terminal way (any Mac, Windows, or Linux)

You don't even need to install anything first — the setup does it all. Open **Terminal**
(Mac: press `⌘ + Space`, type "Terminal", hit enter) and paste this whole block:

```bash
git clone https://github.com/richhabits/sam.git
cd sam
./setup.sh
```

That's it — **`setup.sh` does everything for you**: installs Node if you don't have it, sets SAM
up, starts it, and opens your browser. (Takes a couple of minutes — grab a coffee.)


---

## Give it a brain (free, 60 seconds)

SAM needs one free "AI key" to think. **Groq** is the quickest:

1. Go to **[console.groq.com/keys](https://console.groq.com/keys)** → sign in with Google.
2. Click **Create API Key**, copy it.
3. Come back — you'll add it in the app in a sec (or paste it into the `.env` file if you're comfy).

> Want it beefier? You can add more free keys later (Cerebras, Gemini, NVIDIA…) right inside the app's Settings. All free. SAM juggles them so you never run out.

---

## Run it 🚀

If you let `setup.sh` start it, it's already running. Otherwise, any time:

```bash
npm start
```

Then open your browser to **http://localhost:8787**.

- Tell it your name.
- Click the **⚙ gear → API keys** and paste your Groq key. Hit save.
- Say hi. Ask it anything. Watch it work.

---

## Try these to see what it does

- *"What's the weather where I am?"*
- *"Write me a punchy Instagram bio."*
- *"Search the web for the best free tools for a small business."*
- *"Take a screenshot and tell me what's on my screen."*

Flip the **💼 Business / 🏠 Personal** switch up top to change its vibe.

---

## Bits to know

- 🔒 **It's private.** Runs on your machine. Your stuff never leaves it.
- 🖐️ **It asks first** before anything risky (sending, deleting, running commands). You're always in control.
- 💸 **It's free.** Won't cost you anything unless you deliberately plug in a paid key.
- 🆘 **Stuck?** Text me. Or if something errors, close the Terminal, reopen, `cd sam`, `npm start` again.

Enjoy it 🙌
