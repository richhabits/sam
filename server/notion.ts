// NOTION — read the pages and databases you last touched.
//
// NOTION_API_KEY has been offered in Settings → Integrations for a long time and was read by
// NOTHING: a field that writes a variable no code path opens is a promise the app doesn't keep.
// This makes it real, read-only.
//
// One caveat worth stating in the UI rather than hiding: an internal integration only sees what
// you have explicitly shared with it in Notion. An empty list here usually means "nothing shared
// yet", not "you have no pages".

import { callJson, cap, day, type Row, sub } from "./connectors.http.ts";

const API = "https://api.notion.com/v1";
// Pinned deliberately. Notion versions its API by date and CHANGES RESPONSE SHAPES between them
// (2025-09-03 restructures search around data sources); an unpinned call would rot silently.
const VERSION = "2022-06-28";

function headers(token: string) {
  return { Authorization: `Bearer ${token}`, "Notion-Version": VERSION, "Content-Type": "application/json" };
}

/** Whose integration this is. Doubles as the connection check. */
export async function whoami(token: string): Promise<{ name: string; workspace: string }> {
  const j = await callJson(`${API}/users/me`, { label: "Notion", headers: headers(token) });
  return { name: String(j?.name || j?.bot?.owner?.user?.name || ""), workspace: String(j?.bot?.workspace_name || "") };
}

/** Notion titles are rich-text arrays, and live in a different place on pages than on databases. */
export function titleOf(o: any): string {
  // A database carries `title` at the top level; a page carries it inside whichever property is
  // of type "title" — which is named "Name" in a database and "title" on a workspace page, so it
  // has to be found by type, never by key.
  const rich = Array.isArray(o?.title)
    ? o.title
    : Object.values(o?.properties || {}).find((p: any) => p?.type === "title") as any;
  const parts = Array.isArray(rich) ? rich : rich?.title;
  const text = Array.isArray(parts) ? parts.map((t: any) => t?.plain_text || "").join("").trim() : "";
  return text || "(untitled)";
}

export function toRow(o: any): Row {
  return {
    id: String(o?.id || ""),
    title: titleOf(o),
    sub: sub(o?.object === "database" ? "database" : "page", day(o?.last_edited_time)),
    url: String(o?.url || ""),
  };
}

async function search(token: string, limit: number, object?: "page" | "database"): Promise<Row[]> {
  const j = await callJson(`${API}/search`, {
    label: "Notion",
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({
      page_size: cap(limit, 100),
      // Last edited first: the thing you were just working on is the thing you want to name.
      sort: { direction: "descending", timestamp: "last_edited_time" },
      ...(object ? { filter: { value: object, property: "object" } } : {}),
    }),
  });
  const list = Array.isArray(j?.results) ? j.results : [];
  return list.map(toRow);
}

export const pages = (token: string, limit = 30) => search(token, limit, "page");
export const databases = (token: string, limit = 30) => search(token, limit, "database");
