# App Store assets

`iphone-6.9/` — iPhone 6.9" (1320 × 2868), the size Apple requires for the current
flagship class. Captured on an iPhone 17 Pro Max simulator against a **real paired
SAM**, not fixtures: the Tasks shot is Romeo's own yard.

| file | what it is |
|---|---|
| `store-1-tasks.png`  | framed, captioned — "It shows you what it actually did." |
| `store-2-agent.png`  | framed, captioned — "Your own AI. On your machine." |
| `store-3-brains.png` | framed, captioned — "Free by default. It asks before it spends." |
| `shot-*.png`         | the raw device captures the framed versions are built from |

Regenerate the frames from the raw captures rather than re-shooting: the caption
layout is a small PIL script, and the raw shots are the expensive part.

## Still missing

**iPad 13" (2064 × 2752).** `supportsTablet: true`, so Apple will ask for a set. A
capture was attempted and rejected: the simulator ran the app in an iPadOS window
with the home screen and dock visible behind it, the dev warning banner was up, and
the installed build was an old one carrying the previous icon. A usable set needs a
fresh Release build installed to an iPad simulator, run full-screen.

## Rules worth not relearning

- The dev warning banner ("Open debugger to view warnings") is a **debug artefact**
  and must be dismissed before any capture. A Release build avoids it entirely.
- `SFNS.ttf` has FOUR variation axes — Width, Optical Size, GRAD, Weight. Passing a
  single value to `set_variation_by_axes` sets *Width*, which silently renders a wide
  rounded face instead of SF Pro Display Bold.
