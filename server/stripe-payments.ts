import { deposit, getWallet } from "./wallet.ts";

export interface CheckoutSession {
  id: string;
  url: string;
  amount: number;
  currency: string;
  paymentMethod: string;
}

// In-memory store for pending sessions
const pendingSessions = new Map<string, CheckoutSession>();

/**
 * Creates a mocked Stripe Checkout Session for deposits
 */
export function createStripeCheckoutSession(amountGbp: number, paymentMethod: string): CheckoutSession {
  const sessionId = `cs_test_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
  
  // In a real integration, we would call Stripe's SDK here:
  // const session = await stripe.checkout.sessions.create({ ... })
  
  const session: CheckoutSession = {
    id: sessionId,
    // We redirect them to a mock processing page that instantly returns to the app
    // In reality, this would be a URL like "https://checkout.stripe.com/pay/cs_test_..."
    url: `/api/flipit/mock-checkout-process?session_id=${sessionId}`,
    amount: amountGbp,
    currency: "GBP",
    paymentMethod,
  };

  pendingSessions.set(sessionId, session);
  return session;
}

/**
 * Simulates Stripe's checkout.session.completed webhook
 */
export function handleStripeWebhookSuccess(sessionId: string) {
  const session = pendingSessions.get(sessionId);
  if (!session) {
    throw new Error("Invalid or expired checkout session.");
  }

  // Authorize the deposit in the local wallet
  deposit(session.amount, session.currency);
  pendingSessions.delete(sessionId);
  
  return { success: true, newBalance: getWallet().balance };
}
