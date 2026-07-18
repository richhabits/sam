# Stripping personal-security-checklist — good stuff for SAM, and it's licensed to take

*Source: [Lissy93/personal-security-checklist](https://github.com/Lissy93/personal-security-checklist)
— **CC BY 4.0**, "300+ tips for protecting digital security and privacy in 2026." 12 categories
(Authentication, Web Browsing, Email, Secure Messaging, Social Media, Networks, Mobile, Personal
Computers, Smart Home, Personal Finance, Human Aspect, Physical Security); each tip has a priority
(Essential / Recommended / Optional / Advanced) + details/links. Also published as structured data
+ an API.*

## Verdict: BUILT — a security/privacy coaching skill for SAM

Romeo's hunch was right. This is a strong, on-brand fit and — critically — **the license lets us
take it.** The finding that makes it clean:

**CC BY 4.0 = use/adapt freely, commercial OK, no share-alike — attribution required.** That's the
opposite of the wigolo situation (AGPL → connect-don't-vendor). Here we *can* bake the content into
SAM's own MIT skill, we just credit Lissy93. So we did.

**Why it fits SAM specifically:** SAM is a privacy-first, local-first personal assistant whose users
are individuals/creators — exactly the audience for personal security. And `skills/` had **no
security or privacy skill** (checked: business/life skills + buildx/codeaudit, nothing on staying
safe online). Genuine gap, perfect audience, permissive licence → build.

**Built → `skills/security/SKILL.md`** — SAM as a calm, practical security coach (auto-loads at boot,
triggers on "secure my accounts / privacy / 2FA / been hacked / phishing / …"). What it captures:
- The **12-area map** + the **Essential-first** prioritisation (the checklist's best idea: ~8 must-dos
  beat 300 tips). Baked-in Essentials: password manager + unique passwords, 2FA (app/hardware not
  SMS), device encryption, updates, uBlock, Signal, email aliasing, VPN on public Wi-Fi, backups.
- A **method** (assess gaps → triage biggest exposure → walk one fix end-to-end → track with
  `remember_fact` → pull live tips from the source for depth), so it's a coach, not a wall of text.
- **Safety rules with teeth:** never ask the user to type/paste a real password/seed/2FA code;
  never weaken their security for convenience; the human aspect (phishing/social engineering) is the
  real risk; a calm **breach-response** runbook.
- **The line where it stops being a checklist:** stalking/doxxing/abuse/targeted attacks → that's
  threat-modelling, slow down and route to a specialist helpline, because generic hardening can tip
  off an abuser. Honest, and important.
- **SAM eats its own cooking:** the skill notes SAM itself is built this way (telemetry off by
  default, local-first, content never leaves the device) — authentic, not preachy.
- **Attribution** to Lissy93 / CC BY 4.0 in the skill (licence-required and just correct).

**Ripped in, not linked out (per Romeo's "make it our own"):** because CC BY *permits* it, the
skill embeds SAM's **own, self-contained checklist across all 12 areas** — owned and offline, no
"go fetch Lissy's list" dependency (SAM is local-first; it coaches security without needing the
internet). It's a genuine SAM compilation — the Essentials + the full 12-area reference + the
method — informed by the CC BY source and credited, not a mirror of it. The one place it still
reaches out is *danger* (stalking/abuse) → a live specialist helpline, which is correct.

## FLIP IT

Nothing — a personal-security checklist has no place in a mechanical trading rig, and flip-it's own
key-hygiene ("broker keys in .env, never echo them") is already covered harder by the Money Doctrine.

## BOARD paste block

```
- personal-security-checklist stripped (SECCHECKLIST_STRIP.md): BUILT → `skills/security/SKILL.md`.
  Lissy93's CC BY 4.0 checklist (300+ tips, 12 areas, Essential-first) → SAM's own security/privacy
  coaching skill (new — no security skill existed; perfect fit for a privacy-first local-first
  assistant). Captures the 12-area map + ~9 Essentials + assess/triage/act/track method + safety
  rules (never handle real secrets; human-aspect focus; breach runbook) + the stalking/abuse →
  specialist-helpline line. Licence lets us bake it in (CC BY, attribution given — vs wigolo's AGPL
  connect-only). RIPPED IN / owned: full 12-area checklist embedded, self-contained + offline (no
  fetch dependency), per "make it our own". FLIP IT: nothing.
```
