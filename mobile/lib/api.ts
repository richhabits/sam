import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { demoApi, isDemo, leaveDemo } from "./demo";
import { normalizeHost } from "./pairstate";

// How this device names itself in SAM's device registry — the operator's revoke list. RN's
// User-Agent is a bare CFNetwork/Darwin string with no device in it, so without this every
// phone would show up as "device · browser". Must be one of the tokens server-side
// guessLabel() allows (server/pairing.ts); anything else falls back to UA sniffing.
const CLIENT_HINT =
  Platform.OS === "ios" ? (Platform.isPad ? "ios-ipad" : "ios-iphone") : "android";

// The two things pairing needs to remember between launches: which SAM to talk to, and the
// bearer token that proves this device already paired with it. Both live in the Keychain
// (expo-secure-store), never in AsyncStorage/plain files — this token is exactly as sensitive
// as the session cookie a paired browser holds (see server/pairing.ts).
const HOST_KEY = "sam.host";
const TOKEN_KEY = "sam.token";

export async function getHost(): Promise<string | null> {
  return SecureStore.getItemAsync(HOST_KEY);
}
export async function setHost(host: string): Promise<void> {
  await SecureStore.setItemAsync(HOST_KEY, host.trim().replace(/\/+$/, ""));
}
export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}
async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}
/** Hand this device's pairing back — BOTH halves. Deleting the local token alone (which is all
 *  this used to do) leaves the session alive on the Mac for its full 30-day life: the operator
 *  taps a destructive-looking row, the phone can no longer authenticate, and the credential it
 *  was authenticating with is still sitting in the Mac's device list. That is the access nobody
 *  removed.
 *
 *  Returns whether the Mac was actually told. The local token is wiped either way — stranding
 *  the operator on a phone they cannot un-pair because their Mac is asleep would be a worse
 *  trap than the one this fixes — but the caller MUST surface a false, because "forgotten here
 *  only" and "forgotten everywhere" are different facts about who can still reach your machine. */
export async function forgetDevice(): Promise<{ revokedOnMac: boolean }> {
  let revokedOnMac = false;
  try {
    await api("/api/pair/forget", { method: "POST" });
    revokedOnMac = true;
  } catch {
    // Mac unreachable, already revoked there, or the session was gone. Not fatal to the local
    // wipe below, and never silently swallowed: it is returned and shown.
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  await leaveDemo();
  return { revokedOnMac };
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Exchange a printed pairing code for a session token — the native-app twin of opening
 *  /pair?code=… in a browser (see POST /api/pair/claim in server/index.ts). Stores the host
 *  too, so every call after this one knows where to go without asking again. */
export async function claim(host: string, code: string): Promise<void> {
  // Shared with the "did we already pair?" check in App.tsx — one rule for what counts as the
  // same machine, so the host stored here and the host compared against later cannot drift.
  const base = normalizeHost(host);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let res: Response;
  try {
    res = await fetch(`${base}/api/pair/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SAM-Client": CLIENT_HINT },
      body: JSON.stringify({ code: code.trim() }),
      signal: initSignal(init.signal, controller.signal),
    });
  } catch (e: any) {
    clearTimeout(timer);
    throw new ApiError(0, e?.name === "AbortError" ? "connection timed out" : e?.message || "network request failed");
  }
  clearTimeout(timer);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error || `pairing failed (${res.status})`);
  await setHost(base);
  await setToken(body.token);
}

function initSignal(userSignal?: AbortSignal | null, timeoutSignal?: AbortSignal): AbortSignal | undefined {
  if (userSignal) return userSignal;
  return timeoutSignal;
}

/** Every authenticated call after pairing goes through this — same Bearer-token carrier
 *  sessionTokenFromRequest() reads server-side, so it's authorized exactly like a paired
 *  browser's cookie, nothing more. */
export async function api(path: string, init: RequestInit = {}): Promise<any> {
  // The demo answers here rather than in each screen, so no surface has to know it is in one —
  // and so a screen added later cannot forget to handle it and quietly hit the network.
  if (isDemo()) return demoApi(path);
  const host = await getHost();
  const token = await getToken();
  if (!host || !token) throw new ApiError(401, "not paired");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  let res: Response;
  try {
    res = await fetch(`${host}${path}`, {
      ...init,
      signal: initSignal(init.signal, controller.signal),
      headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    clearTimeout(timer);
    throw new ApiError(0, e?.name === "AbortError" ? "connection timed out" : e?.message || "network request failed");
  }
  clearTimeout(timer);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error || `request failed (${res.status})`);
  return body;
}
