// ─────────────────────────────────────────────────────────────
//  S.A.M. · THE YARD — the glass
//
//  The live preview is already served, confined and un-cacheable. What it could not do
//  was tell you WHICH part of the page you meant. Describing a change in words —
//  "the heading above the booking form, not the one in the header" — is the slowest part
//  of using a builder, and it is slow every single time.
//
//  So the preview can be served in SELECT mode: click an element, and the glass learns
//  the selector for it. The edit that follows names the element exactly instead of
//  describing it, which is the difference between steering a build and negotiating
//  with one.
//
//  The security shape is fixed by how the preview is already served, and it is a good
//  shape: `Content-Security-Policy: sandbox allow-scripts` puts that document in an
//  OPAQUE origin with `connect-src 'none'`. So the script injected below cannot call
//  SAM's API, cannot read a cookie, and cannot fetch anything — even though SAM serves
//  it from SAM's own origin and a model wrote the page around it. The one channel out
//  is `postMessage`, which is why the selector travels that way and why the receiving
//  side must check the message came from the frame it is showing.
//
//  Injection is opt-in per request. A preview opened normally is byte-for-byte the file
//  on disk — the page you ship is never the page with SAM's script in it.
// ─────────────────────────────────────────────────────────────

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import type { FileDiff } from "./diff.ts";

// The marker the parent checks for. Anything can postMessage to a window, so the glass
// treats a message without this as noise from somewhere else.
export const GLASS_SOURCE = "sam-glass";

// Kept deliberately small and dependency-free: it is injected into someone else's page,
// so it must not need a build step, must not leak globals beyond one namespaced object,
// and must not change how the page looks until the operator hovers.
const SELECT_JS = `(function(){
  if (window.__samGlass) return;
  window.__samGlass = true;

  // A selector specific enough to find one element again, short enough for a person to
  // read in the composer. id wins outright; otherwise walk up adding nth-of-type only
  // where a tag alone is ambiguous.
  function selectorFor(el){
    if (!el || el.nodeType !== 1) return "";
    if (el.id) return "#" + CSS.escape(el.id);
    var parts = [];
    while (el && el.nodeType === 1 && el.tagName.toLowerCase() !== "html") {
      var tag = el.tagName.toLowerCase();
      var parent = el.parentElement;
      if (!parent) { parts.unshift(tag); break; }
      var sameTag = Array.prototype.filter.call(parent.children, function(c){
        return c.tagName === el.tagName;
      });
      if (sameTag.length > 1) tag += ":nth-of-type(" + (sameTag.indexOf(el) + 1) + ")";
      parts.unshift(tag);
      if (el.id) { parts[0] = "#" + CSS.escape(el.id); break; }
      el = parent;
    }
    return parts.join(" > ");
  }

  var outline = document.createElement("div");
  outline.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #E8673A;border-radius:3px;background:rgba(232,103,58,.10);transition:all .06s;display:none";
  document.documentElement.appendChild(outline);

  function frame(el){
    var r = el.getBoundingClientRect();
    outline.style.display = "block";
    outline.style.left = r.left + "px";
    outline.style.top = r.top + "px";
    outline.style.width = r.width + "px";
    outline.style.height = r.height + "px";
  }

  document.addEventListener("mouseover", function(e){
    if (e.target === outline || e.target === document.documentElement) return;
    frame(e.target);
  }, true);
  document.addEventListener("mouseout", function(){ outline.style.display = "none"; }, true);

  // Capture phase and prevented: in select mode a click means "this is what I mean",
  // never "follow this link". A preview that navigates away on the first click is a
  // preview you cannot point at.
  document.addEventListener("click", function(e){
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    parent.postMessage({
      source: ${JSON.stringify(GLASS_SOURCE)},
      selector: selectorFor(el),
      tag: el.tagName ? el.tagName.toLowerCase() : "",
      text: (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 80)
    }, "*");
  }, true);
})();`;

const SELECT_SCRIPT = `\n<script>${SELECT_JS}</script>\n`;

// The preview's CSP is `default-src 'self'` with no script-src, which forbids INLINE script
// — so the picker was injected and then silently refused to run. It is not enough to be in
// the page; the policy has to name it. A sha256 of the exact script body does that without
// weakening anything else: no 'unsafe-inline', no per-request nonce to keep in step, and a
// policy that stops matching the moment the script is edited. Sent only on select responses.
//
// script-src also has to repeat 'self', because naming script-src at all stops default-src
// applying to scripts — omitting it would newly break a previewed page that loads its own
// ./app.js, in select mode only, which is the sort of difference that gets blamed on the
// page rather than on us.
export const SELECT_SCRIPT_SRC = `script-src 'self' 'sha256-${createHash("sha256").update(SELECT_JS).digest("base64")}'`;

// The whole preview policy, built here rather than written inline at the route, because the
// bug this fixes was a DISAGREEMENT between the body and the header: the page carried an
// inline script the policy did not admit, and nothing in the codebase held those two facts
// close enough together to notice. They are one function now, and a test can hold it to the
// only invariant that matters — a select-mode policy must admit what select mode injects.
//
// `sandbox` is what makes the rest safe: an opaque origin whatever loads the page, framed or
// opened directly, so a model-written page cannot reach SAM's API with the browser's
// authority. `connect-src 'none'` leaves postMessage as the picker's only way out.
export function previewCsp(select: boolean): string {
  return [
    "sandbox allow-scripts",
    "default-src 'self'",
    ...(select ? [SELECT_SCRIPT_SRC] : []),
    "img-src 'self' data: blob:",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "connect-src 'none'",
    "frame-ancestors 'self'",
  ].join("; ");
}

// Injected before </body> so the page's own scripts have already defined whatever they
// define. A document with no </body> (a fragment, or malformed output from a model) gets
// it appended — the alternative is silently doing nothing on exactly the pages most
// likely to need pointing at.
export function withSelect(html: string): string {
  const at = html.toLowerCase().lastIndexOf("</body>");
  if (at === -1) return html + SELECT_SCRIPT;
  return html.slice(0, at) + SELECT_SCRIPT + html.slice(at);
}

// Whether this request asked for select mode. A single explicit flag, so the default —
// and anything embedded elsewhere — is the untouched file.
export function wantsSelect(query: unknown): boolean {
  const q = (query ?? {}) as Record<string, unknown>;
  return String(q.select ?? "") === "1";
}

// ── Diffs, kept beside the job's log ────────────────────────────────────────
// The loop already produces a diff per write. Surfacing them needs them to outlive the
// job's memory, and a job already owns a path for exactly this kind of thing — so they
// sit next to the log rather than in a new table nobody else uses.

export function diffPathFor(logPath: string): string {
  return `${logPath}.diffs.json`;
}

export function saveDiffs(logPath: string | null, diffs: FileDiff[]): void {
  if (!logPath || !diffs.length) return;
  try { writeFileSync(diffPathFor(logPath), JSON.stringify(diffs)); }
  catch { /* a diff that cannot be written must never fail the build that produced it */ }
}

export function loadDiffs(logPath: string | null): FileDiff[] {
  if (!logPath) return [];
  const p = diffPathFor(logPath);
  if (!existsSync(p)) return [];
  try {
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
