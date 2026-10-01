// The last middleware in the stack: turns anything a route (or body-parser) threw into a small
// JSON answer.
//
// Without it Express 5 falls back to its default handler, which answers with an HTML page. Outside
// NODE_ENV=production that page carries the stack trace — absolute file paths on the operator's
// disk — and a malformed or oversized JSON body (the 30mb express.json limit) reaches it too.
// Every SAM client expects JSON, so a plain `{ error }` is also the shape they can render.
import type { NextFunction, Request, Response } from "express";

export function jsonErrorHandler(err: any, _req: Request, res: Response, next: NextFunction): void {
  // Part of the response is already on the wire (an SSE stream that threw mid-answer): a second
  // status line is impossible, so hand it to Express, which closes the socket.
  if (res.headersSent) { next(err); return; }

  const status = Number(err?.status ?? err?.statusCode);
  if (status >= 400 && status < 500) {
    // Client mistakes (body-parser sets status + type). Safe to name the class of problem, never the detail.
    const error = err?.type === "entity.too.large" ? "request body too large"
      : err?.type === "entity.parse.failed" ? "request body is not valid JSON"
      : "bad request";
    res.status(status).json({ error });
    return;
  }

  // Our own bug. Say so in the log (console is already scrubbed), say nothing useful to the caller.
  try { console.error("[SAM] unhandled route error:", err instanceof Error ? err.message : String(err)); } catch { /* logging must never itself throw */ }
  res.status(500).json({ error: "internal error" });
}
