// ─────────────────────────────────────────────────────────────
//  S.A.M. · MAILER  — SAM's own email (SMTP). Provider-agnostic:
//  works with Gmail (app password), IONOS, Fastmail, any SMTP host.
//  Dormant until configured, so it never fails a build/boot.
//    SMTP_HOST=smtp.gmail.com  SMTP_PORT=587  (465 = implicit TLS)
//    SMTP_USER=sam@you.com     SMTP_PASS=<app password>
//    SMTP_FROM="SAM <sam@you.com>"   SAM_OWNER_EMAIL=you@you.com
// ─────────────────────────────────────────────────────────────

import nodemailer, { type Transporter } from "nodemailer";

let _transport: Transporter | null = null;
let _from = "";

// True only when the minimum SMTP creds are present — everything gates on this so an
// unconfigured SAM silently skips email instead of erroring.
export function mailerConfigured(): boolean {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function transport(): Transporter | null {
  if (_transport) return _transport;
  if (!mailerConfigured()) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,   // 465 = implicit TLS; 587/25 = STARTTLS
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  });
  _from = process.env.SMTP_FROM || process.env.SMTP_USER!;
  return _transport;
}

// Who SAM emails by default (the owner's inbox).
export function ownerEmail(): string { return process.env.SAM_OWNER_EMAIL || process.env.SMTP_USER || ""; }

export async function sendMail(to: string, subject: string, body: string): Promise<{ ok: boolean; error?: string }> {
  if (!mailerConfigured()) return { ok: false, error: "Email isn't set up. Add SMTP_HOST/SMTP_USER/SMTP_PASS to .env (see .env.example)." };
  const t = transport();
  if (!t) return { ok: false, error: "Email isn't set up. Add SMTP_HOST/SMTP_USER/SMTP_PASS to .env (see .env.example)." };
  const dest = (to || ownerEmail()).trim();
  if (!dest) return { ok: false, error: "No recipient (set SAM_OWNER_EMAIL or pass a 'to')." };
  try {
    await t.sendMail({ from: _from, to: dest, subject: subject || "(no subject)", text: body || "" });
    return { ok: true };
  } catch (e: any) {
    _transport = null;   // drop a broken transport so a fixed config is picked up next time
    return { ok: false, error: String(e?.message || e).slice(0, 300) };
  }
}
