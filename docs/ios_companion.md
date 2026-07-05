# SAM · iOS Companion Setup

Talk to SAM from your iPhone or Apple Watch — no app required.

## How it works

SAM watches a folder on your computer. When you drop a text note into it from your phone, SAM reads it, processes it, and acts on it. That's it.

The folder syncs automatically via iCloud Drive, so it works even when your phone and Mac are miles apart.

## Setup (2 minutes)

### Step 1: The Folder

SAM automatically creates the drop folder when it starts. The location depends on your OS:

| OS | Path |
|----|------|
| **macOS** | `~/Library/Mobile Documents/com~apple~CloudDocs/SAM_Drop` |
| **Windows** | `~/iCloudDrive/SAM_Drop` |
| **Linux** | `~/SAM_Drop` |

You can override this by setting `SAM_DROP_FOLDER` in your `.env` file.

### Step 2: The Apple Shortcut

Create a shortcut on your iPhone that drops a text file into the SAM_Drop folder:

1. Open **Shortcuts** on your iPhone
2. Tap **+** to create a new shortcut
3. Add these actions:

```
Action 1: Ask for Input
  → Type: Text
  → Prompt: "What do you need SAM to do?"

Action 2: Text
  → Set to: [Ask for Input result]

Action 3: Save File
  → Save [Text] to iCloud Drive/SAM_Drop/
  → Filename: sam-[Current Date].txt
  → Ask Where to Save: OFF
```

4. Name it **"Tell SAM"**
5. Add it to your Home Screen or set it as a Siri command

### Step 3: Voice Notes (Optional)

If you want to dictate to SAM instead of typing:

```
Action 1: Dictate Text
Action 2: Save File
  → Save [Dictated Text] to iCloud Drive/SAM_Drop/
  → Filename: sam-voice-[Current Date].txt
```

Or, to send a raw voice memo for SAM to transcribe:

```
Action 1: Record Audio
Action 2: Save File
  → Save [Recording] to iCloud Drive/SAM_Drop/
  → Filename: sam-voice-[Current Date].m4a
```

> **Note:** For audio transcription, install [Whisper](https://github.com/openai/whisper) on your computer: `pip install openai-whisper`. Without it, SAM will note that a voice memo was received but can't transcribe it.

### Step 4: Apple Watch

The shortcut you created works on Apple Watch too:

1. Open **Watch** app on your iPhone
2. Go to **Shortcuts**
3. Toggle on **"Tell SAM"**

Now you can raise your wrist and say **"Hey Siri, Tell SAM"** to dictate a task while you're running, driving, or away from your desk.

## What happens next

1. Your iPhone drops the file into iCloud Drive
2. iCloud syncs it to your Mac (usually within seconds)
3. SAM detects the new file, reads it, and processes it as a command
4. SAM sends a desktop notification with the result
5. The drop file is cleaned up automatically

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Files not syncing | Make sure iCloud Drive is enabled on both devices |
| SAM not picking up files | Check that SAM is running (`npm run dev` or the native app) |
| Wrong folder | Set `SAM_DROP_FOLDER=/your/path` in `.env` |
| Audio not transcribed | Install Whisper: `pip install openai-whisper` |
