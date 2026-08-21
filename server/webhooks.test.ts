import { describe, it, expect } from "vitest";
import {
  computeHmacSignature,
  verifyInboundSignature,
  registerWebhookEndpoint,
  dispatchWebhookEvent,
  loadWebhookEndpoints,
} from "./webhooks.ts";

describe("SECURE EVENT WEBHOOKS & INBOUND SIGNAL ENGINE", () => {
  it("computes and verifies HMAC-SHA256 signatures with timing-safety", () => {
    const payload = JSON.stringify({ event: "order.created", amount: 150 });
    const secret = "super_secret_webhook_key_12345";

    const sig = computeHmacSignature(payload, secret);
    expect(sig).toHaveLength(64);

    const valid = verifyInboundSignature(payload, sig, secret);
    expect(valid).toBe(true);

    const invalid = verifyInboundSignature(payload, "invalid_sig_abc123", secret);
    expect(invalid).toBe(false);
  });

  it("registers and dispatches webhook events to matching listeners", async () => {
    const ep = registerWebhookEndpoint("Test Endpoint", "https://example.com/webhook", ["flipit.trade", "alert"]);
    expect(ep.id).toBeDefined();
    expect(ep.secret).toBeDefined();

    const mockFetcher = async (url: any, init: any) => {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
      } as Response;
    };

    const deliveries = await dispatchWebhookEvent("flipit.trade", { ticker: "BTC", size: 0.5 }, {
      fetcher: mockFetcher as any,
    });

    expect(deliveries.length).toBeGreaterThanOrEqual(1);
    expect(deliveries[0].status).toBe("success");
    expect(deliveries[0].statusCode).toBe(200);
  });
});
