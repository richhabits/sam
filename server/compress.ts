// ─────────────────────────────────────────────────────────────
//  S.A.M. · CONTEXT COMPRESSION (built-in & free)
//  Big tool outputs (web pages, MCP/API JSON, file reads) get
//  RE-SENT to the model every agent-loop step, so they dominate
//  token cost. We shrink each result before it enters the running
//  transcript — JSON minified (the huge win on structured data),
//  long prose kept head+tail — and cache the originals so SAM can
//  pull the full text back on demand (reversible). Pure token
//  savings = more free-tier headroom, faster replies, no deps.
// ─────────────────────────────────────────────────────────────

const _full = new Map<string, string>();   // id → original (reversible retrieval)
let _seq = 0;

function headTail(raw: string, toolName: string): string {
  const id = `${toolName}#${_seq++}`;
  _full.set(id, raw);
  if (_full.size > 40) { const k = _full.keys().next().value; if (k) _full.delete(k); }   // bound the cache
  return `${raw.slice(0, 2600)}\n…[${raw.length - 3400} chars compressed — call retrieve_full with id "${id}" for the rest]…\n${raw.slice(-800)}`;
}

export function compressToolOutput(toolName: string, result: string): string {
  const raw = result || "";
  if (raw.length <= 1200) return raw;   // small — nothing to gain
  const trimmed = raw.trim();
  // 1) JSON → minify: strip insignificant whitespace (the 60-95% win on structured data).
  if (trimmed[0] === "{" || trimmed[0] === "[") {
    try {
      const min = JSON.stringify(JSON.parse(trimmed));
      if (min.length < raw.length * 0.85) return min.length > 4000 ? headTail(min, toolName) : min;
    } catch { /* not clean JSON — fall through */ }
  }
  // 2) Long prose → keep the informative head + tail; cache the middle for retrieval.
  if (raw.length > 4000) return headTail(raw, toolName);
  return raw;
}

export function retrieveFullOutput(id: string): string | null { return _full.get(id) ?? null; }
