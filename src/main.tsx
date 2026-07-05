import { createRoot } from "react-dom/client";
import { lazy, Suspense } from "react";
import App from "./App";
import "./styles.css";

// ?app=studio (dedicated Electron window or a tab) → the Creative Space, else the chat.
const StudioView = lazy(() => import("./StudioView"));
const isStudio = new URLSearchParams(location.search).get("app") === "studio";

createRoot(document.getElementById("root")!).render(
  isStudio ? <Suspense fallback={null}><StudioView /></Suspense> : <App />
);
