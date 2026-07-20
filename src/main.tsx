import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import App from "./App";
import "./styles.css";

// A packaged Electron build loads the UI from file://, where a root-relative URL
// like "/api/command" resolves to file:///api/command and fails — so every server
// call would break. When (and only when) we're on file://, point root-relative
// requests at the local SAM server. In the browser and dev/single-process the page
// is served over http(s), so same-origin relative URLs already work (Vite proxies
// /api in dev). This one shim covers every fetch in the app — no per-call-site base.
// One fetch shim covers every server call. It does two jobs:
//  1. On file:// (packaged Electron) rewrite root-relative "/api/…" to the local server's origin.
//  2. Attach the per-launch control token (the Handshake) to /api requests when we have one — the
//     legit renderer gets it via preload/contextBridge. Enforcement is opt-in server-side; when it's
//     on, this header is what lets the real frontend through while a random local process is refused.
{
  const onFile = typeof location !== "undefined" && location.protocol === "file:";
  const BASE = "http://localhost:8787";
  const token = (globalThis as unknown as { samDesktop?: { controlToken?: string } }).samDesktop?.controlToken || "";
  if (onFile || token) {
    const orig = window.fetch.bind(window);
    window.fetch = (input: any, init?: any) => {
      const isApi = typeof input === "string" && (input.startsWith("/api/") || input.includes("/api/"));
      const target = onFile && typeof input === "string" && input.startsWith("/") && !input.startsWith("//") ? BASE + input : input;
      if (token && isApi) {
        const headers = new Headers(init?.headers || undefined);
        headers.set("X-SAM-Token", token);
        return orig(target, { ...init, headers });
      }
      return orig(target, init);
    };
  }
}

// Register the service worker (push + offline shell). Only over http(s), not file:// (Electron).
if (typeof location !== "undefined" && location.protocol.startsWith("http") && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {/* browser API unavailable in this context — optional enhancement */}));
}

// ?app=studio → the Creative Space; ?app=flipit → the £5 money desk; else the chat.
// Each is its own full-view entity (dedicated Electron window or a browser tab).
const StudioView = lazy(() => import("./StudioView"));
const FlipItView = lazy(() => import("./FlipItView"));
const whichApp = new URLSearchParams(location.search).get("app");

createRoot(document.getElementById("root")!).render(
  whichApp === "studio" ? <Suspense fallback={null}><StudioView /></Suspense>
  : whichApp === "flipit" ? <Suspense fallback={null}><FlipItView /></Suspense>
  : <App />
);
