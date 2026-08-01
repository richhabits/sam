// CONNECTORS · shared plumbing. One error type, one fetch, one way to find a secret — so the
// five service files below it are only the part that differs (the URL and the shape).
//
// Split out from connectors.ts so the service modules can import this without importing the
// dispatcher that imports them.

import type { ConnectorSpec } from "./connectors.registry.ts";
import { getKey, readSecret } from "./keys.ts";

// Same reasoning as github.ts and embeddings: `fetch` has no default timeout, and a black-holed
// socket otherwise hangs the request forever.
export const TIMEOUT_MS = Number(process.env.SAM_CONNECTOR_TIMEOUT_MS) || 15_000;

/** One row, whatever the service. The + sheet and the desktop pane both stay dumb because of it. */
export type Row = { id: string; title: string; sub?: string; url?: string };

export class ConnectorError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/**
 * 401 means "no token / bad token" everywhere in here, and callers turn ONLY that into
 * "connect this" — an outage and a missing credential are different problems and only one of
 * them is fixable by the operator.
 */
export function noToken(label: string): ConnectorError {
  return new ConnectorError(401, `no ${label} token yet — add one in Settings → Integrations`);
}

/** The secret for a connector: the rotating pool for GitHub (it is also a model provider), else the Safe/env. */
export function tokenFor(spec: ConnectorSpec): string | null {
  return spec.pooled ? getKey(spec.id) : readSecret(spec.env);
}

/** GET/POST JSON with a timeout, mapping the statuses everyone agrees on to ConnectorError. */
export async function callJson(url: string, init: RequestInit & { label: string }): Promise<any> {
  const { label, ...rest } = init;
  let r: Response;
  try {
    r = await fetch(url, { ...rest, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e: any) {
    // A timeout or a DNS failure is the service being unreachable, never a credential problem —
    // reporting it as 401 would tell the operator to re-paste a token that is perfectly fine.
    throw new ConnectorError(502, e?.name === "TimeoutError" ? `${label} did not answer in time` : `could not reach ${label}`);
  }
  if (r.status === 401) throw new ConnectorError(401, `that ${label} token was rejected — it may have expired`);
  if (r.status === 403) throw new ConnectorError(403, `${label} refused: the token is missing a scope, or you are rate limited`);
  if (r.status === 429) throw new ConnectorError(429, `${label} is rate limiting — try again shortly`);
  if (!r.ok) throw new ConnectorError(r.status, `${label} returned ${r.status}`);
  return r.json();
}

/** Bounds a caller-supplied limit. Every list endpoint takes one and none of them should trust it. */
export function cap(limit: number | undefined, max = 100, fallback = 30): number {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/** ISO timestamp → the date, which is all any of these rows have room for. */
export function day(iso: string | null | undefined): string {
  return typeof iso === "string" ? iso.slice(0, 10) : "";
}

/** Join the non-empty parts of a subtitle. Every service builds one and none want " · · ". */
export function sub(...parts: (string | null | undefined | false)[]): string {
  return parts.filter(Boolean).join(" · ");
}
