import type { Express } from "express";

// SAM Creative Space — a thin proxy to muapi. Extracted from index.ts; the routes and their
// registration order are unchanged (registerX(app), not a Router, so no mount point can shift
// a path). Self-contained: it closes over nothing from index.ts and reads only its own env key.
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
    if (!/^[a-zA-Z0-9._~/-]*$/.test(targetPath) || targetPath.includes("..")) {
      return res.status(400).json({ error: "Invalid creative path" });
    }
    const targetUrl = `https://api.muapi.ai/api/v1/${targetPath}`;

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
