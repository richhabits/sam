// ─────────────────────────────────────────────────────────────
//  S.A.M. · MONZO-STYLE WALLET (FlipIt)
//
//  "If the user wants to invest £5, make it possible that they do it legally
//  and cover our ass."
//  This module manages the local wallet ledger, KYC/AML state, and 
//  deposits. In production, this bridges to Stripe Identity/Issuing or Plaid.
// ─────────────────────────────────────────────────────────────

import { join } from "node:path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.VAULT_DIR || join(__dirname, "..", "vault");
const WALLET_FILE = join(VAULT_DIR, "wallet.json");

export type KYCStatus = "unverified" | "pending" | "verified" | "rejected";

export interface Transaction {
  id: string;
  type: "deposit" | "withdrawal" | "investment" | "dividend";
  amount: number; // in pennies/cents
  currency: string;
  status: "pending" | "completed" | "failed";
  timestamp: string;
  reference: string;
}

export interface WalletState {
  balance: number;       // in pennies/cents
  currency: string;
  kyc: KYCStatus;
  transactions: Transaction[];
  stripeCustomerId?: string;
  plaidItemId?: string;
}

const DEFAULT_STATE: WalletState = {
  balance: 0,
  currency: "GBP",
  kyc: "unverified",
  transactions: [],
};

// Ensures atomic-ish writes for the wallet
function saveWallet(state: WalletState) {
  if (!existsSync(VAULT_DIR)) mkdirSync(VAULT_DIR, { recursive: true });
  writeFileSync(WALLET_FILE, JSON.stringify(state, null, 2));
}

export function getWallet(): WalletState {
  if (!existsSync(WALLET_FILE)) {
    saveWallet(DEFAULT_STATE);
    return DEFAULT_STATE;
  }
  try {
    return JSON.parse(readFileSync(WALLET_FILE, "utf8")) as WalletState;
  } catch {
    return DEFAULT_STATE;
  }
}

export function requestKYC(): WalletState {
  const state = getWallet();
  if (state.kyc === "unverified" || state.kyc === "rejected") {
    state.kyc = "pending"; // In a real app, this creates a Stripe Identity session
    saveWallet(state);
  }
  return state;
}

// Webhook for KYC approval
export function approveKYC(): WalletState {
  const state = getWallet();
  state.kyc = "verified";
  saveWallet(state);
  return state;
}

export function deposit(amount: number, currency: string = "GBP"): { state: WalletState; error?: string } {
  const state = getWallet();
  
  // Legal / Ass-covering: No real deposits without KYC
  if (state.kyc !== "verified") {
    return { state, error: "KYC verification required before making deposits." };
  }

  const tx: Transaction = {
    id: `tx_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: "deposit",
    amount,
    currency,
    status: "completed",
    timestamp: new Date().toISOString(),
    reference: "Bank Transfer",
  };

  state.balance += amount;
  state.transactions.unshift(tx);
  saveWallet(state);
  return { state };
}
