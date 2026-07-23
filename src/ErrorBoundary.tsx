import React from "react";

// AUDIT FIX: SAM's HUD had no React error boundary anywhere, so a render-time error in a
// single model-driven widget (a chart JSON with no `series`, a followup with no `questions`)
// unwound the whole tree and white-screened the entire app. A boundary catches a subtree's
// error and shows a small inline fallback, so one bad item can never take the chat down.
interface Props { children: React.ReactNode; fallback?: React.ReactNode; label?: string }
interface State { failed: boolean }

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { failed: false };
  static getDerivedStateFromError(): State { return { failed: true }; }
  componentDidCatch(err: unknown) {
    // Best-effort breadcrumb; never rethrow — the point is to CONTAIN the failure.
    console.warn(`[SAM] ${this.props.label || "a component"} failed to render:`, err);
  }
  render() {
    if (this.state.failed) {
      return this.props.fallback ?? <div className="widget-error">This item couldn’t be displayed.</div>;
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
