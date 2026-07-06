import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMailMock = vi.fn(async () => ({ messageId: "1" }));
vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: sendMailMock }) } }));

import { mailerConfigured, sendMail, ownerEmail } from "./mailer.ts";

const clearSmtp = () => { for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "SAM_OWNER_EMAIL"]) delete process.env[k]; };

describe("mailer", () => {
  beforeEach(() => { clearSmtp(); sendMailMock.mockClear(); });

  it("is not configured without SMTP creds", () => {
    expect(mailerConfigured()).toBe(false);
  });

  it("sendMail returns a helpful error (not a throw) when unconfigured", async () => {
    const r = await sendMail("a@b.com", "hi", "x");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/SMTP|set up/i);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("sends when SMTP creds are present", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "sam@example.com";
    process.env.SMTP_PASS = "app-pw";
    expect(mailerConfigured()).toBe(true);
    const r = await sendMail("you@example.com", "hi", "body");
    expect(r.ok).toBe(true);
    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ to: "you@example.com", subject: "hi", text: "body" }));
  });

  it("ownerEmail falls back to SMTP_USER, overridden by SAM_OWNER_EMAIL", () => {
    process.env.SMTP_USER = "sam@example.com";
    expect(ownerEmail()).toBe("sam@example.com");
    process.env.SAM_OWNER_EMAIL = "you@example.com";
    expect(ownerEmail()).toBe("you@example.com");
  });
});
