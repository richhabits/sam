# 👋 Hey — welcome to SAM

My mate built this. It's **your own private AI assistant** that runs on your computer — free.
Not just a chatbot: it actually *does* stuff (searches the web, reads your files, drafts emails,
and loads more) and it asks before anything risky. Takes about **5 minutes** to set up. Let's go.

---

## What you need first (one-time)

**1. Node.js** — the thing that runs it.
Go to **[nodejs.org](https://nodejs.org)**, download the big green "LTS" button, install it. Done.

*(On a Mac and like the terminal? `brew install node` also works. If not, ignore this.)*

---

## Get SAM onto your computer

Open **Terminal** (Mac: press `⌘ + Space`, type "Terminal", hit enter) and paste this whole block:

```bash
git clone https://github.com/richhabits/sam.git
cd sam
./setup.sh
```

That's it — **`setup.sh` does everything for you**: installs it, sets it up, and offers to start it. (Takes a minute — grab a coffee.)

> ⚠️ **Get a "repository not found" or password prompt?** The repo is private — ask me (the owner) to invite you, and make sure you're logged into GitHub in Terminal (`gh auth login`). Once you're invited, the clone works.

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
