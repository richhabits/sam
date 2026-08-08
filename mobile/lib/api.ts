import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { isDemo, demoApi } from "./demo";

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
/** Forget this device's pairing entirely (the mobile-side half of "revoke" — the server
 *  side is whatever the operator does from /api/pair/devices/:id/revoke on the Mac). */
export async function forgetDevice(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
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
  const base = host.trim().replace(/\/+$/, "");
  const res = await fetch(`${base}/api/pair/claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-SAM-Client": CLIENT_HINT },
    body: JSON.stringify({ code: code.trim() }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error || `pairing failed (${res.status})`);
  await setHost(base);
  await setToken(body.token);
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
  const res = await fetch(`${host}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body?.error || `request failed (${res.status})`);
  return body;
}
