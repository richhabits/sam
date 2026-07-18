# Design system audit — `src/styles.css`

Measured, not opined. Every number below came from a command in this file, run against the
tracked source on 2026-07-18. Where a fix changed a number, both are shown.

**Headline: the send button's disabled glyph was invisible on both light themes (1.49:1 on
classic, 1.62:1 on linen).** That is fixed, along with six other objective bugs. The style
sheet is otherwise structurally sound — this is a token-hygiene problem, not a rewrite.

Scope note: the visual claims here are derived from the CSS and from computed WCAG contrast
ratios. **Nothing in this document was verified by looking at a rendered screen.**

---

## 0. How the theme system actually works

This is the single most important thing to understand before touching the file, and it is not
obvious from reading it.

There are **two independent axes**, not one:

| Axis | Attribute | Values |
|---|---|---|
| Skin | `data-skin` on `<html>` | 8 named skins + `classic` (attribute *removed*, so `:root` is the classic theme) |
| Light/dark | `data-theme` on `<html>` | `light` \| `dark` |

`src/App.tsx:460` sets `data-theme` from `dark || darkSkin` — so the dark axis is driven by the
user's toggle **or** by the skin being a dark one. The two are not locked together: a user can
select the `linen` (paper) skin and *still* have the dark toggle on. That combination is
reachable and it was broken — see bug 2.

`:root[data-theme="dark"]` and `:root[data-skin="linen"]` have **identical specificity** (0,2,0),
so which one wins is decided purely by source order. Linen is declared at line ~750, the dark
block at line 38, so linen's *variables* win. But dark's *element* rules — which hardcode
colours — kept firing regardless.

```bash
# the two axes and where they're set
grep -n 'data-skin\|data-theme' src/App.tsx | head -5
grep -nE '^:root\[data-(skin|theme)' src/styles.css
```

---

## 1. Custom properties: 23 → 25 tokens across 9 themes

```bash
# distinct token names declared
grep -oE '\-\-[a-z0-9-]+\s*:' src/styles.css | sed 's/[[:space:]]*:$//' | sort -u | wc -l
# distinct token names consumed via var()
grep -oE 'var\(--[a-z0-9-]+' src/styles.css | sed 's/var(//' | sort -u | wc -l
# tokens USED but never DECLARED anywhere — the dangerous set
comm -13 <(grep -oE '\-\-[a-z0-9-]+\s*:' src/styles.css | sed 's/[[:space:]]*:$//' | sort -u) \
         <(grep -oE 'var\(--[a-z0-9-]+' src/styles.css | sed 's/var(//' | sort -u)
```

| | before | after |
|---|---|---|
| distinct tokens declared | 23 | 25 |
| tokens consumed via `var()` | 25 | 24 |
| **consumed but never declared** | **5** (`--line --m --mono --panel --v`) | **2** (`--m --v`) |

`--m` and `--v` are correct: `src/VoiceMode.tsx:43,181` sets them inline per-frame for the voice
orb, and both call sites carry a sane fallback. The other three were **phantom tokens** — no
theme ever declared them, so the hardcoded fallback won 100% of the time in all 9 themes while
*looking* theme-aware. Fixed in §3.

### Theme completeness matrix

```bash
node -e '
const fs=require("fs");const css=fs.readFileSync("src/styles.css","utf8");
const blocks={};const re=/:root(\[data-(?:skin|theme)="([a-z]+)"\])?\s*\{([^}]*)\}/g;let m;
while((m=re.exec(css))){const n=m[2]||"classic(:root)";
  const p=[...m[3].matchAll(/(--[a-z0-9-]+)\s*:/g)].map(x=>x[1]);
  if(p.length)blocks[n]=(blocks[n]||[]).concat(p);}
const root=new Set(blocks["classic(:root)"]);
for(const n of Object.keys(blocks)){const s=new Set(blocks[n]);
  console.log(n.padEnd(16)+String(s.size).padEnd(5)+(n.startsWith("classic")?"—":[...root].filter(v=>!s.has(v)).join(" ")||"none"));}'
```

Result at audit time (vars declared / missing vs `:root`):

```
classic(:root)  23   —
dark            12   --c-blue --c-ok --c-err --c-err-bg --c-bg2 --sans --display --radius --shadow-accent --accent-2 --ring
jarvis          15   ... --radius
ember           12   ... --radius --shadow-accent --accent-2 --ring
stealth         13   ... --shadow-accent --accent-2 --ring
midnight        15   ... --radius
nord            14   ... --radius --shadow-accent
dracula         14   ... --radius --shadow-accent
linen           14   ... --radius --shadow-accent
aurora          14   ... --radius --shadow-accent
```

**Most of this inheritance is correct and should stay.** `--sans`, `--display`, `--radius`,
`--c-blue/-ok/-err/-err-bg/-bg2` are deliberately theme-agnostic: a skin changes colour, not
typeface or corner radius. `--ring` is also a false alarm — `:root` defines it as
`0 0 0 3.5px var(--accent-soft)`, which re-resolves per theme, so inheriting it is correct.

**The two real leaks were `--shadow-accent` and `--accent-2`** — both hardcoded terracotta in
`:root`, both consumed by `.send` (line ~420, `box-shadow: var(--shadow-accent)` and
`linear-gradient(135deg, var(--accent), var(--accent-2))`). 7 of 9 themes never overrode
`--shadow-accent`, so **the send button glowed terracotta under a cyan, green or purple accent**,
and under `stealth` the gradient ran green → terracotta. Fixed in §3.

---

## 2. Contrast bugs (the objective ones)

Ratios computed with the WCAG 2.1 relative-luminance formula:

```bash
node -e '
const hex=h=>{h=h.replace("#","");if(h.length===3)h=[...h].map(c=>c+c).join("");
  return[0,2,4].map(i=>parseInt(h.slice(i,i+2),16))};
const lum=c=>{const[r,g,b]=hex(c).map(v=>{v/=255;
  return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4});return .2126*r+.7152*g+.0722*b};
const cr=(a,b)=>{const[x,y]=[lum(a),lum(b)].sort((m,n)=>n-m);return (x+.05)/(y+.05)};
console.log(cr("#FFFFFF","#D6D3D1").toFixed(2));  // .send:disabled on classic'
```

### Bug 1 — the send button's disabled glyph was invisible on light themes ← highest value

`.send:disabled { background: var(--border-strong); color: #fff }`. White on `--border-strong`:

| theme | `--border-strong` | ratio | |
|---|---|---|---|
| **classic** | `#D6D3D1` | **1.49:1** | invisible |
| **linen** | `#D6CAB3` | **1.62:1** | invisible |
| nord | `#4C566A` | 7.38:1 | fine |
| dracula | `#44475A` | 9.15:1 | fine |
| jarvis / ember / stealth / midnight | — | 11.2–14.1:1 | fine |

The author wrote this rule on a dark theme, where it reads perfectly. On the two light themes
the send arrow simply disappeared until you had typed something. This is the most-used control
in the app.

**Fixed** → `color: color-mix(in srgb, var(--text) 70%, transparent)`, which derives from the
theme: **3.71:1 (linen) – 6.55:1 (stealth)**, every theme ≥3:1.

### Bug 2 — code tokens illegible on `linen` + dark toggle

Eight `:root[data-theme="dark"] .foo { … }` rules hardcode dark-ground colours. Because the two
axes are independent (§0), they fired on linen's paper background:

| rule | colour | on linen surface `#FBF8F1` |
|---|---|---|
| `.tok-s` (strings) | `#7ee787` | **1.45:1** |
| `.tok-k` (keywords) | `#ff9d5c` | **1.94:1** |
| `.tok-n` (numbers) | `#d19a66` | **2.32:1** |
| `.tok-c` (comments) | `#6b737c` | 4.53:1 |

Syntax highlighting in code blocks was pale-green-on-cream — effectively unreadable. The light
defaults these rules were overriding are all fine (3.00–4.88:1).

**Fixed** → the 9 dark-only *element* rules are now guarded with
`:root[data-theme="dark"]:not([data-skin="linen"])`, so the light defaults apply under linen.
The variable block is untouched. `.app` (line 45) needed no guard: linen's own `.app` rule
follows it in source order and already wins.

### Bug 3 — white text on bright accents

16 rules paint `color: #fff` on `background: var(--accent)`. White is only safe on the warm,
dark accents:

| skin | accent | white text | |
|---|---|---|---|
| linen | `#B0703C` | 4.02:1 | ok (large/bold) |
| classic | `#E8673A` | 3.26:1 | ok (large/bold) |
| midnight | `#A78BFA` | 2.72:1 | poor |
| ember | `#F0824E` | 2.62:1 | poor |
| dracula | `#BD93F9` | 2.41:1 | poor |
| **jarvis** | `#29C6F6` | **2.00:1** | fail |
| **nord** | `#88C0D0` | **2.00:1** | fail |
| **stealth** | `#4ADE80` | **1.74:1** | fail (worst in set) |

**Fixed conservatively** → introduced `--on-accent` (defaults to `#fff`) and replaced all 16
hardcoded `#fff` with `var(--on-accent)`. Only the three skins at ≤2.00:1 override it:

| skin | new ink | ratio |
|---|---|---|
| jarvis | `#04222F` | 8.24:1 |
| stealth | `#052012` | 9.86:1 |
| nord | `#1B2430` | 7.82:1 |

**Deliberately not changed:** classic, ember, linen, aurora, midnight, dracula keep white.
Classic/ember/linen are the looks the owner already signed off, and midnight/dracula at
2.4–2.7:1 are borderline on bold button text — flipping them to dark ink would restyle six
themes to fix two marginal cases. The token is now in place if that call is ever made: one
line per skin.

### Bug 4 — `.widget-error`

`color: #ff4a4a` → 3.21:1 on classic, 2.90:1 on linen. Now
`color-mix(in srgb, var(--c-err) 70%, var(--text))` over a `--c-err` tint, so it tracks the theme.

---

## 3. Hardcoded colour outside theme definitions

```bash
grep -oE '#[0-9a-fA-F]{3,8}\b' src/styles.css | wc -l                    # all hex: 234
# unscoped: not a token declaration, not a .prev-* swatch, not inside a themed selector
grep -nE '#[0-9a-fA-F]{3,8}\b' src/styles.css \
  | grep -vE ':\s*--|--[a-z0-9-]+:\s*#' | grep -vE ':\s*\.prev-' \
  | grep -v 'data-skin=\|data-theme=' | grep -v 'DESIGN FIX' | wc -l
```

| | before | after |
|---|---|---|
| all hex literals in the file | 234 | 218 |
| …in token declarations (legitimate — this *is* the theme) | 110 | 118 |
| …in `.prev-*` skin swatches (legitimate — literal previews of each skin) | 19 | 19 |
| **unscoped hex in normal rules** | **61** | **36** |

The 25 removed were the ones that could not adapt. The **36 remaining are deliberate**: fixed
semantic colours that must not shift with theme (`#EF4444` danger, `#22C55E` on-state,
`#16a34a` market-up / `#ef4444` market-down, `#F59E0B` warning), plus pairs that already ship a
correct light default *and* a dark override (`.pop-lanes`, `.dash-security`, `.pop-opt.elon`,
`.tok-*`). That pattern is right and was left alone.

### Phantom tokens fixed

| was | always resolved to | now |
|---|---|---|
| `var(--line, #2c2c3a)` ×2 | near-black dashed border in *every* theme, including on paper | `var(--border-strong)` |
| `var(--panel, rgba(232,103,58,.08))` | terracotta tint under every skin's accent | `var(--accent-soft)` |
| `var(--panel, rgba(127,127,127,.06))` | flat grey | `var(--surface)` |
| `var(--mono, monospace)` | bare `monospace` | `--mono` now declared in `:root` |

Also removed 7 dead fallbacks (`var(--text, #eee)`, `var(--muted, #9a9ab0)`,
`var(--accent, #8b7bf7)`). Those tokens are declared by every theme, so the fallbacks were
unreachable — and they were purple/grey values from some other project, which actively misled
anyone reading the file about what the theme looks like.

---

## 4. Scale consistency — this is the real "clutter"

```bash
grep -oE 'padding:[^;}]*'       src/styles.css | sed 's/padding:\s*//'       | sort -u | wc -l
grep -oE 'border-radius:[^;}]*' src/styles.css | sed 's/border-radius:\s*//' | sort -u | wc -l
grep -oE 'font-size:\s*[^;}]*'  src/styles.css | sed 's/font-size:\s*//'     | sort -u | wc -l
grep -oE 'gap:\s*[^;}]*'        src/styles.css | sed 's/gap:\s*//'           | sort -u | wc -l
```

| property | distinct values |
|---|---|
| `padding` | **118** |
| `border-radius` | 23 (16 distinct px values) |
| `font-size` | 23 (22 distinct px values) |
| `gap` | 17 |

Font sizes in use: `10 11 11.5 12 12.5 13 13.5 14 14.5 15 16 17 18 19 20 22 24 26 28 30 34 44`
Radii in use: `5 6 7 8 9 10 11 12 14 16 18 20 24 28 99 999`

**118 distinct paddings is not a system.** Neither is a type scale with 22 steps where six of
them differ by half a pixel (`11/11.5`, `12/12.5`, `13/13.5`, `14/14.5`) — differences nobody
can see but every future edit has to guess between. Same for radii: `5,6,7,8,9,10,11,12` is
eight values doing one job, and `99` vs `999` are two spellings of "pill".

**This was measured and deliberately NOT fixed in this pass.** Collapsing 118 paddings onto a
4px scale touches nearly every rule in the file — that is a wholesale reformat, it is
unreviewable as a diff, `src/styles.css` is shared with other agents right now, and it would
change spacing the owner has already approved. It is the correct *next* piece of work, done
deliberately: define `--space-1..6` and `--text-xs..3xl`, then migrate section by section.

---

## 5. Dead and duplicated CSS

```bash
grep -oE '^\.[a-z0-9-]+(\.[a-z0-9-]+)?\s*\{' src/styles.css | sed 's/\s*{//' | sort | uniq -d | wc -l
grep -oE '\.[a-z][a-z0-9-]{2,}' src/styles.css | sort -u | wc -l
```

- **521** distinct class selectors defined.
- **17** selectors defined more than once (some intentional — a base rule plus a later
  section override; not all are bugs).
- **25** classes never appearing as a literal string in `src/*.tsx`.

The 25 are **candidates, not confirmed dead**: 9 are `.prev-*` swatches built dynamically as
`` `skin-prev prev-${id}` ``, and others (`.tok-c`, `.code-wrap`) are emitted by the markdown
renderer rather than written in JSX. Deleting on this signal alone would break things.
Left alone deliberately; needs a runtime coverage check, not grep.

---

## 6. What changed in this pass

All edits are commented in-place with a `DESIGN FIX:` prefix so they survive review.

| # | Fix | Where |
|---|---|---|
| 1 | disabled send glyph 1.49:1 → 3.71–6.55:1 | `src/styles.css:301` |
| 2 | 9 dark-only element rules guarded off the `linen` skin | `src/styles.css:525,616,617,812–815,920,921` |
| 3 | `--on-accent` token + 16 call sites; jarvis/stealth/nord overrides | `:root` + 3 skin blocks |
| 4 | `--shadow-accent` derived from `--accent` (fixes 7 skins at once) | `src/styles.css:28` |
| 5 | `--accent-2` added to stealth (was terracotta on a green button) | stealth block |
| 6 | phantom `--line`/`--panel` removed; `--mono` declared | 5 sites |
| 7 | `.widget-error` 2.90:1 → theme-derived | `src/styles.css:644` |

Net: unscoped hardcoded hex **61 → 36**; undeclared tokens **5 → 2** (both legitimately set
inline by `VoiceMode.tsx`). Diff: **58 insertions, 38 deletions** in one file.

### Verification

```
npx tsc --noEmit -p tsconfig.json   → exit 0
npm test                            → 53 files, 452 passed | 2 skipped
npm run build                       → built, dist/server.mjs 558.7kb
npm run lint                        → 205 files, 0 errors, 17 warnings (pre-existing)
```

Token presence confirmed in the built bundle, not just the source:

```bash
f=$(ls dist/assets/*.css | head -1)
grep -o '\-\-on-accent:' "$f" | wc -l                        # 4 declarations
grep -o 'var(--on-accent)' "$f" | wc -l                      # 16 uses
grep -o 'not(\[data-skin=[^]]*linen[^]]*\])' "$f" | wc -l    # 9 guards
grep -c 'var(--line' "$f"                                    # 0 phantom tokens
```

(The minifier strips attribute-selector quotes, so grep for `data-skin=linen`, not
`data-skin="linen"`, when checking the bundle.)

### Not verified

No rendered page was inspected. Every claim above is either a computed contrast ratio or a
static property of the CSS cascade. The changes that a human should eyeball on a real Mac:
the three skins whose button ink flipped from white to dark (**jarvis, stealth, nord**), and
**linen with the dark toggle on**.
