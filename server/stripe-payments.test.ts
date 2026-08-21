import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  createStripeCheckoutSession,
  verifyStripeWebhookSignature,
  processStripeWebhookEvent,
} from "./stripe-payments.ts";
import { getWallet, approveKYC } from "./wallet.ts";

describe("Production Stripe Payments & Webhook Engine", () => {
  const originalEnv = process.env.STRIPE_SECRET_KEY;

  afterEach(() => {
    if (originalEnv) process.env.STRIPE_SECRET_KEY = originalEnv;
    else delete process.env.STRIPE_SECRET_KEY;
  });

  it("returns explicit error when STRIPE_SECRET_KEY is unconfigured without fake data", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const res = await createStripeCheckoutSession({ amountGbp: 50 });
    expect(res.status).toBe("failed");
    expect(res.error).toContain("STRIPE_SECRET_KEY is not configured");
  });

  it("creates real checkout session with valid API key", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_mock_valid_key";

    const mockFetcher = async (url: any, init: any) => {
      expect(url).toContain("checkout/sessions");
      expect(init.headers.Authorization).toContain("Bearer sk_test_mock_valid_key");
      return {
        ok: true,
        json: async () => ({
          id: "cs_test_real_stripe_session_12345",
          url: "https://checkout.stripe.com/c/pay/cs_test_real_stripe_session_12345",
          livemode: false,
        }),
      } as any;
    };

    const res = await createStripeCheckoutSession(
      { amountGbp: 25, customerEmail: "romeo@hectic.com" },
      { fetcher: mockFetcher as any }
    );

    expect(res.status).toBe("created");
    expect(res.id).toBe("cs_test_real_stripe_session_12345");
    expect(res.url).toContain("checkout.stripe.com");
  });

  it("verifies authentic Stripe webhook signatures with HMAC-SHA256 and tolerance", () => {
    const rawBody = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });
    const secret = "whsec_test_secret_998877665544332211";
    const nowSec = Math.floor(Date.now() / 1000);

    const sig = createHmac("sha256", secret).update(`${nowSec}.${rawBody}`).digest("hex");
    const header = `t=${nowSec},v1=${sig}`;

    const valid = verifyStripeWebhookSignature(rawBody, header, secret);
    expect(valid).toBe(true);

    const tampered = verifyStripeWebhookSignature("tampered_body", header, secret);
    expect(tampered).toBe(false);

    // Old timestamp outside tolerance
    const oldHeader = `t=${nowSec - 500},v1=${sig}`;
    const expired = verifyStripeWebhookSignature(rawBody, oldHeader, secret, 300);
    expect(expired).toBe(false);
  });

  it("credits local wallet when processing checkout.session.completed event", () => {
    approveKYC();
    const initialBalance = getWallet().balance;
    const event = {
      id: "evt_test_123",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          amount_total: 5000, // £50.00
          currency: "gbp",
        },
      },
    };

    const res = processStripeWebhookEvent(event);
    expect(res.success).toBe(true);
    expect(res.action).toContain("Deposited £50.00");
    expect(getWallet().balance).toBe(initialBalance + 50);
  });
});
