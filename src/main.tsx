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
if (typeof location !== "undefined" && location.protocol === "file:") {
  const BASE = "http://localhost:8787";
  const orig = window.fetch.bind(window);
  window.fetch = (input: any, init?: any) =>
    orig(typeof input === "string" && input.startsWith("/") && !input.startsWith("//") ? BASE + input : input, init);
}

// Register the service worker (push + offline shell). Only over http(s), not file:// (Electron).
if (typeof location !== "undefined" && location.protocol.startsWith("http") && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {/* browser API unavailable in this context — optional enhancement */}));
}

// ?app=studio (dedicated Electron window or a tab) → the Creative Space, else the chat.
const StudioView = lazy(() => import("./StudioView"));
const isStudio = new URLSearchParams(location.search).get("app") === "studio";

createRoot(document.getElementById("root")!).render(
  isStudio ? <Suspense fallback={null}><StudioView /></Suspense> : <App />
);
