// ─────────────────────────────────────────────────────────────
//  S.A.M. · WEB ENGINE (Jina AI)  — clean search + page reading
//  s.jina.ai = search, r.jina.ai = read a page as clean text.
//  Used when JINA_API_KEY is set; SAM falls back to a free
//  scraper otherwise so the web always works.
// ─────────────────────────────────────────────────────────────

function headers() {
  const key = process.env.JINA_API_KEY || "";
  return key ? { Authorization: `Bearer ${key}`, "X-Retain-Images": "none" } : undefined;
}

export function hasJina() { return !!process.env.JINA_API_KEY; }

export async function jinaSearch(query: string): Promise<string> {
  const res = await fetch(`https://s.jina.ai/${encodeURIComponent(query)}`, { headers: headers() });
  if (!res.ok) throw new Error(`jina search ${res.status}`);
  return (await res.text()).trim();
}

export async function jinaRead(url: string): Promise<string> {
  if (!/^https?:\/\//.test(url)) url = "https://" + url;
  const res = await fetch(`https://r.jina.ai/${url}`, { headers: headers() });
  if (!res.ok) throw new Error(`jina read ${res.status}`);
  return (await res.text()).trim();
}
