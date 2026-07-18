import type { Express } from "express";

// SAM Creative Space — a thin proxy to muapi. Extracted from index.ts; the routes and their
// registration order are unchanged (registerX(app), not a Router, so no mount point can shift
// a path). Self-contained: it closes over nothing from index.ts and reads only its own env key.
const MUAPI_BASE = "https://api.muapi.ai/api/v1/";

// The SSRF guard, pulled out as a pure function so it can be tested directly. Exported for
// `routes.creative.ssrf.test.ts` — a test that re-declared this regex would only prove the copy
// matches itself, so the test must call the SAME function the route calls.
//
// Whitelist, not blacklist: only unreserved URL path characters. That is what blocks the whole
// redirect class in one rule — ":" and "//" (scheme), "@" (credentials), "\\" (Windows-style
// separators some parsers fold to "/"), and crucially "%" (so no percent-encoded ".." or "/"
// can smuggle past the literal ".." check below). Traversal is then checked on the decoded
// value, because Express decodes wildcard params before we see them.
export function isSafeCreativePath(targetPath: string): boolean {
  return /^[a-zA-Z0-9._~/-]*$/.test(targetPath) && !targetPath.includes("..");
}

// Build the outbound URL. Returns null when the path is unsafe, so a caller cannot forget the
// check and still get a URL — the guard and the construction are one step, not two.
export function creativeTargetUrl(targetPath: string): string | null {
  return isSafeCreativePath(targetPath) ? `${MUAPI_BASE}${targetPath}` : null;
}

export function registerCreativeRoutes(app: Express) {
  // ── SAM Creative Space (Proxy to Muapi) ──────────────────────
  app.all("/api/creative/*", async (req, res) => {
    // ONLY the muapi key — no OpenAI fallback: an OpenAI key isn't valid at muapi anyway,
    // so the old fallback just leaked the user's OpenAI credential to a third party.
    const apiKey = process.env.MUAPI_API_KEY;
    if (!apiKey) return res.status(503).json({ error: "No MUAPI_API_KEY configured for SAM Creative Space" });

    // Sanitize the wildcard path so it can only address muapi's own API surface — no
    // "..", scheme, host, credentials or backslashes that could redirect the request
    // elsewhere (SSRF). Only plain path segments are allowed.
    const targetPath = String((req.params as unknown as Record<string, string | undefined>)["0"] ?? "");
    const targetUrl = creativeTargetUrl(targetPath);
    if (targetUrl === null) {
      return res.status(400).json({ error: "Invalid creative path" });
    }

    try {
      const headers: Record<string, string> = { "x-api-key": apiKey };
      if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"] as string;

      const query = new URLSearchParams(req.query as Record<string, string>).toString();
      const finalUrl = query ? `${targetUrl}?${query}` : targetUrl;

      const body = ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body);

      const r = await fetch(finalUrl, { method: req.method, headers, body });
      const text = await r.text();
      res.status(r.status);
      try { res.json(JSON.parse(text)); } catch { res.send(text); }
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });
}
