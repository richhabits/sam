// ─────────────────────────────────────────────────────────────
//  S.A.M. · PRODUCTION STRIPE PAYMENTS & CHECKOUT ENGINE
//
//  Direct Stripe API integration for checkout session creation,
//  customer billing, and timing-safe webhook verification (HMAC-SHA256).
// ─────────────────────────────────────────────────────────────

import { createHmac, timingSafeEqual } from "node:crypto";
import { deposit, getWallet } from "./wallet.ts";
import { getKey } from "./keys.ts";

export interface CheckoutSessionParams {
  amountGbp: number;
  paymentMethod?: string;
  successUrl?: string;
  cancelUrl?: string;
  customerEmail?: string;
}

export interface StripeCheckoutResult {
  id: string;
  url: string;
  amount: number;
  currency: string;
  status: "created" | "failed";
  livemode: boolean;
  error?: string;
}

export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, any>;
  };
}

/**
 * Retrieves the active Stripe secret key from environment or Safe key vault.
 */
export function getStripeSecretKey(): string {
  return process.env.STRIPE_SECRET_KEY || getKey("stripe") || "";
}

/**
 * Creates a genuine Stripe Checkout Session via Stripe's REST API.
 */
export async function createStripeCheckoutSession(
  params: CheckoutSessionParams,
  options: { fetcher?: typeof fetch } = {}
): Promise<StripeCheckoutResult> {
  const secretKey = getStripeSecretKey();
  const fetchImpl = options.fetcher || fetch;
  const amountPence = Math.round(params.amountGbp * 100);

  if (!secretKey) {
    // Return explicit configuration requirement rather than fabricating fake keys
    return {
      id: "unconfigured",
      url: "",
      amount: params.amountGbp,
      currency: "GBP",
      status: "failed",
      livemode: false,
      error: "STRIPE_SECRET_KEY is not configured. Add your key in Settings or .env to activate live payments.",
    };
  }

  const successUrl = params.successUrl || "http://localhost:8808/app?payment=success&session_id={CHECKOUT_SESSION_ID}";
  const cancelUrl = params.cancelUrl || "http://localhost:8808/app?payment=cancelled";

  const formBody = new URLSearchParams();
  formBody.append("payment_method_types[]", "card");
  formBody.append("mode", "payment");
  formBody.append("success_url", successUrl);
  formBody.append("cancel_url", cancelUrl);
  formBody.append("line_items[0][price_data][currency]", "gbp");
  formBody.append("line_items[0][price_data][unit_amount]", String(amountPence));
  formBody.append("line_items[0][price_data][product_data][name]", "SAM Deposit & Account Funding");
  formBody.append("line_items[0][quantity]", "1");

  if (params.customerEmail) {
    formBody.append("customer_email", params.customerEmail);
  }

  try {
    const res = await fetchImpl("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formBody.toString(),
      signal: AbortSignal.timeout(10000),
    });

    const data = await res.json();
    if (!res.ok) {
      return {
        id: "",
        url: "",
        amount: params.amountGbp,
        currency: "GBP",
        status: "failed",
        livemode: false,
        error: data?.error?.message || `Stripe API error (${res.status})`,
      };
    }

    return {
      id: data.id,
      url: data.url,
      amount: params.amountGbp,
      currency: "GBP",
      status: "created",
      livemode: !!data.livemode,
    };
  } catch (e: any) {
    return {
      id: "",
      url: "",
      amount: params.amountGbp,
      currency: "GBP",
      status: "failed",
      livemode: false,
      error: e?.message || "Failed to connect to Stripe API",
    };
  }
}

/**
 * Verifies a Stripe Webhook signature header against the raw request payload.
 * Header format: "t=1492774577,v1=5257a869e7eceeda32a1a157549a3fa3...[,v0=...]"
 */
export function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
  toleranceSec = 300
): boolean {
  if (!rawBody || !signatureHeader || !webhookSecret) return false;

  const items = signatureHeader.split(",");
  let timestamp = "";
  const signatures: string[] = [];

  for (const item of items) {
    const [key, val] = item.trim().split("=");
    if (key === "t") timestamp = val;
    if (key === "v1") signatures.push(val);
  }

  if (!timestamp || signatures.length === 0) return false;

  const nowSec = Math.floor(Date.now() / 1000);
  const tsNum = Number(timestamp);
  if (isNaN(tsNum) || Math.abs(nowSec - tsNum) > toleranceSec) {
    return false; // Replay attack protection
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = createHmac("sha256", webhookSecret).update(signedPayload).digest("hex");

  for (const sig of signatures) {
    try {
      const sigBuf = Buffer.from(sig, "hex");
      const expBuf = Buffer.from(expectedSignature, "hex");
      if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
        return true;
      }
    } catch {
      // Continue checking next signature
    }
  }

  return false;
}

/**
 * Handles incoming verified Stripe webhook event and credits the operator's wallet.
 */
export function processStripeWebhookEvent(event: StripeWebhookEvent): { success: boolean; action: string; newBalance?: number } {
  if (event.type === "checkout.session.completed") {
    const session = event.data?.object;
    const amountPence = Number(session?.amount_total || 0);
    const amountGbp = amountPence > 0 ? amountPence / 100 : 0;
    const currency = String(session?.currency || "GBP").toUpperCase();

    if (amountGbp > 0) {
      deposit(amountGbp, currency);
      return {
        success: true,
        action: `Deposited £${amountGbp.toFixed(2)} from completed checkout ${session.id}`,
        newBalance: getWallet().balance,
      };
    }
  }

  return { success: true, action: `Ignored event type: ${event.type}` };
}
