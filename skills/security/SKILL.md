---
name: Digital Security & Privacy
tier: free
triggers: secure my accounts, am i safe online, privacy, harden, protect my data, security checklist, password manager, 2fa, two factor, been hacked, data breach, phishing, scam, vpn, encrypt my, online safety, digital security, delete my data, stalker, doxxed
---

# Digital Security & Privacy skill

SAM as a calm, practical personal-security coach: find where the user is exposed, fix the
highest-impact gaps first, one concrete step at a time. This is **SAM's own security knowledge
base** — owned and offline (SAM is local-first; it doesn't need the internet to coach this).
Compiled from standard security practice and adapted from
[Lissy93/personal-security-checklist](https://github.com/Lissy93/personal-security-checklist)
(CC BY 4.0). SAM practises it too: telemetry off by default, content never leaves the device.

## How to run it

- **Assess first, ~4 questions:** password reuse? 2FA on email + bank? device encryption on?
  backups? Map answers to gaps below.
- **Triage by exposure, not by list order.** Almost always: reused passwords → 2FA on email →
  device encryption. Fix the biggest hole first.
- **One fix, end to end.** Make them actually do it; `remember_fact` what's done so you resume
  from where they are. Never fear-monger — security is layered, not a panic.

## THE ESSENTIALS (do these before anything else)

- **Password manager + unique passwords** — every account different, generated & stored (Bitwarden / KeePassXC / 1Password). Kills credential-stuffing from breaches. The single biggest win.
- **2FA on the accounts that matter** — email, bank, password manager first. **App/passkey/hardware key (TOTP, YubiKey), not SMS** where possible (SIM-swap).
- **Device encryption** — FileVault (Mac) · BitLocker (Windows) · LUKS (Linux) · phone PIN+biometric. Lost/stolen ≠ data breached.
- **Auto-update everything** — OS, browser, apps. Most real hacks are old patched holes.
- **Backups** — 3 copies, 2 media, 1 offsite, ≥1 encrypted. Beats ransomware *and* dead drives.

## THE FULL CHECKLIST (SAM's owned reference, by area)

**Authentication** — password manager; unique passwords everywhere; length > complexity (passphrases); 2FA on all important accounts; prefer TOTP/passkeys/hardware keys over SMS; store backup codes offline; check haveibeenpwned for your emails; never reuse the password-manager master password anywhere.

**Web Browsing** — uBlock Origin (ad/tracker/malware blocker); a privacy browser (Firefox/Brave) or hardened Chromium; HTTPS-only mode on; block third-party cookies; a container/multi-account setup to separate identities; minimise extensions (each is attack surface); a private search engine (DuckDuckGo/Startpage); clear or auto-expire cookies; beware typosquatt/look-alike domains before you log in.

**Email** — it's your master key (resets flow here) → strongest password + 2FA; separate addresses for important vs signups; use aliasing (SimpleLogin / Fastmail / Apple Hide-My-Email) so a breach can't be traced/reused; don't open unexpected attachments; verify sender before acting on "urgent" money/login requests; a privacy-respecting provider (Proton/Tutanota) for sensitive mail.

**Secure Messaging** — Signal as the default for anything sensitive (E2E, minimal metadata, open source); verify safety numbers for high-stakes contacts; disappearing messages on; avoid SMS for anything private; don't back up E2E chats to an unencrypted cloud.

**Social Media** — lock down privacy settings; assume anything posted is permanent & public; strip location/EXIF from photos; don't overshare travel/routine in real time; review connected third-party apps; separate personal and public personas; be alert to impersonation and quizzes that harvest security answers.

**Networks** — change default router admin password + firmware auto-update; WPA3/WPA2 + a strong Wi-Fi password; guest network for IoT/visitors; **don't trust public Wi-Fi** — reputable VPN or your phone hotspot; consider encrypted DNS (DoH/DoT); disable WPS/UPnP if unused.

**Mobile Devices** — strong PIN (6+ digits, not a birthday) + biometric; auto-updates; review app permissions (esp. location/mic/camera/contacts); install from official stores only; disable lock-screen previews for sensitive notifications; enable remote-wipe (Find My / Find My Device); turn off Wi-Fi/Bluetooth auto-join in public.

**Personal Computers** — full-disk encryption; auto-lock + a strong login password; reputable OS-native protections on; a non-admin daily account; encrypted backups; cover/disable webcam when unused; be wary of USB devices you don't own; uninstall software you don't use.

**Smart Home** — inventory what's listening; change default creds; segment onto the IoT/guest VLAN; disable cameras/mics you don't need; check the vendor's data & update policy before buying; prefer local-control devices over cloud-only.

**Personal Finance** — 2FA + unique password on bank/broker/PayPal; card + transaction alerts on; a virtual/one-time card for online shops; freeze your credit if unused; never share full card/OTP over phone/email; watch for "your account is locked" phishing.

**Human Aspect (the biggest risk)** — most breaches are social, not technical. Teach the reflex: **verify out-of-band before you click, pay, or share.** Slow down on urgency/authority/fear pressure. Don't reuse real answers for "security questions" (they're public) — store fake ones in the password manager. Assume unsolicited calls/texts/DMs asking for codes or money are scams.

**Physical Security** — lock screens (auto-lock short); privacy screen in public; shred sensitive documents; secure/encrypt backups physically; a hardware key or PIN, not just biometrics, at borders; beware shoulder-surfing when entering PINs/passwords.

## Rules

- **Never ask the user to type or paste a real password, seed phrase, 2FA code, recovery code, or
  private key** — not to "check", not ever. If a secret appears, tell them it's burned → rotate it.
- **Never weaken security for convenience** (no "just turn off 2FA").
- Recommend **reputable, ideally open-source** tools; name the trade-off when there is one.
- **Breach response** (hacked/leaked), in order, calmly: change that password + everywhere it was
  reused → enable 2FA → check haveibeenpwned → watch for follow-on phishing → alert bank if financial.

## When it's danger, not a checklist

If the user is **stalked, doxxed, abused, or specifically targeted** (not just "worried"), this is
threat-modelling, not a tips list: slow down, don't guess, and route them to specialist help (e.g.
Access Now Digital Security Helpline, or a local domestic-abuse digital-safety service) — generic
hardening can tip off an abuser. Say so plainly.

## Output

Their gaps mapped to the Essentials, the single most important fix with exact steps, and what's
next. Close with the honest caveat: this raises the bar, it's not a guarantee — high-risk people
(journalists, activists, abuse survivors) need tailored threat-modelling. *Checklist structure
adapted from [Lissy93](https://github.com/Lissy93/personal-security-checklist), CC BY 4.0.*
