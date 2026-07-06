// Client push: register the service worker, subscribe to Web Push, tell the server.
// iOS needs the PWA installed (Add to Home Screen) + iOS 16.4+; Android works in-browser.

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerSW(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try { return await navigator.serviceWorker.register("/sw.js"); } catch { return null; }
}

export type PushResult = "ok" | "denied" | "unsupported" | "error";

// Ask for permission + subscribe. Returns a status the UI can show.
export async function enablePush(): Promise<PushResult> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  try {
    const reg = (await navigator.serviceWorker.getRegistration()) || (await registerSW());
    if (!reg) return "error";
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return "denied";
    const { key } = await fetch("/api/push/key").then((r) => r.json());
    if (!key) return "error";
    const existing = await reg.pushManager.getSubscription();
    const sub = existing || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource });
    await fetch("/api/push/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sub) });
    return "ok";
  } catch { return "error"; }
}

export async function pushEnabled(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(reg && (await reg.pushManager.getSubscription()));
  } catch { return false; }
}
