// ─────────────────────────────────────────────────────────────
//  docs/PRIVACY.md → docs/privacy.html
//
//  App Store Connect will not accept a submission without a privacy policy URL, and the only
//  thing this site served was the raw markdown: https://richhabits.github.io/sam/PRIVACY.md
//  returns 200, but a browser renders it as unstyled plain text. That is a thin thing to hand a
//  reviewer for a mandatory field.
//
//  GENERATED, not hand-written, on purpose. A privacy policy copied into HTML drifts from the
//  markdown the moment either is edited, and the version that goes stale is always the one Apple
//  is pointed at. PRIVACY.md stays the single source; this renders it.
//
//  The converter covers exactly what PRIVACY.md uses — headings, tables, lists, bold, inline
//  code, links, paragraphs — and nothing else. It is not a markdown engine and should not grow
//  into one: if the policy ever needs a construct that isn't here, add that construct.
// ─────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(join(ROOT, "docs/PRIVACY.md"), "utf8");

// Escape FIRST, then add markup, so nothing in the source can inject tags.
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Inline: code before bold/links, so `**` inside backticks stays literal.
const inline = (s) =>
  esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Italics AFTER bold, and only where the asterisk isn't part of a `**` pair — otherwise
    // "*you*" shipped to the page as literal asterisks.
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

const lines = md.split("\n");
const out = [];
let i = 0;
let title = "Privacy";

while (i < lines.length) {
  const line = lines[i];

  // Table — a header row, a separator row, then body rows.
  if (/^\s*\|/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
    const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
    out.push("<table><thead><tr>" + cells(line).map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>");
    i += 2;
    while (i < lines.length && /^\s*\|/.test(lines[i])) {
      out.push("<tr>" + cells(lines[i]).map((c) => `<td>${c}</td>`).join("") + "</tr>");
      i++;
    }
    out.push("</tbody></table>");
    continue;
  }

  // List — consecutive bullets become one <ul>. A bullet's text may CONTINUE on following
  // indented lines, which is how PRIVACY.md is actually written; treating those as new
  // paragraphs split sentences mid-clause ("…inspectable and deletable in" / new paragraph /
  // "What SAM has learned about you") and made the policy read like it had been shredded.
  if (/^\s*[-*]\s+/.test(line)) {
    out.push("<ul>");
    while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
      const parts = [lines[i].replace(/^\s*[-*]\s+/, "").trim()];
      i++;
      while (i < lines.length && /^\s+\S/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i])) {
        parts.push(lines[i].trim());
        i++;
      }
      out.push(`<li>${inline(parts.join(" "))}</li>`);
    }
    out.push("</ul>");
    continue;
  }

  const h = line.match(/^(#{1,4})\s+(.*)$/);
  if (h) {
    const level = h[1].length;
    if (level === 1) title = h[2].trim();
    out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    i++;
    continue;
  }

  if (line.trim() === "") { i++; continue; }
  if (/^---+$/.test(line.trim())) { out.push("<hr>"); i++; continue; }

  // Paragraph — join until a blank line so wrapped source doesn't become one <p> per line.
  const para = [];
  while (i < lines.length && lines[i].trim() !== "" && !/^\s*[-*]\s+/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i]) && !/^\s*\|/.test(lines[i])) {
    para.push(lines[i].trim());
    i++;
  }
  if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · SAM</title>
<meta name="description" content="How SAM handles your data: it runs on your machine, and by default nothing about you leaves it.">
<style>
  :root{
    --ink:#100E0C; --surface:#1C1712;
    --paper:#F3EDE4; --ash:#9A9187;
    --ember:#F0824E; --ember-soft:rgba(240,130,78,.12); --line:rgba(240,130,78,.14);
    --sans:-apple-system,BlinkMacSystemFont,"SF Pro Display","SF Pro Text","Segoe UI",system-ui,sans-serif;
    --mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--ink);color:var(--paper);font-family:var(--sans);line-height:1.65;
       -webkit-font-smoothing:antialiased}
  .wrap{max-width:760px;margin:0 auto;padding:56px 22px 96px}
  a{color:var(--ember)}
  .back{font-family:var(--mono);font-size:13px;color:var(--ash);text-decoration:none;
        border:1px solid var(--line);padding:8px 14px;border-radius:9px;display:inline-block;margin-bottom:38px}
  .back:hover{color:var(--paper);background:var(--ember-soft)}
  h1{font-size:clamp(30px,5vw,42px);line-height:1.15;margin:0 0 10px;letter-spacing:-.02em}
  h2{font-size:22px;margin:44px 0 12px;letter-spacing:-.01em}
  h3{font-size:17px;margin:30px 0 8px;color:var(--ember)}
  p{margin:0 0 16px}
  ul{margin:0 0 18px;padding-left:22px}
  li{margin:0 0 7px}
  code{font-family:var(--mono);font-size:.88em;background:var(--surface);
       border:1px solid var(--line);border-radius:5px;padding:1px 6px}
  hr{border:0;border-top:1px solid var(--line);margin:38px 0}
  /* Wide tables scroll inside their own box — the page itself must never scroll sideways. */
  .tw{overflow-x:auto;margin:0 0 22px}
  table{border-collapse:collapse;width:100%;font-size:14.5px;min-width:420px}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top}
  th{font-family:var(--mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--ash)}
  @media (prefers-color-scheme: light){
    :root{--ink:#FDF9F4;--surface:#F3EDE4;--paper:#231C16;--ash:#6B655D}
  }
</style>
</head>
<body>
<div class="wrap">
<a class="back" href="./">← SAM</a>
${out.join("\n")}
</div>
</body>
</html>
`;

// Tables get a scroll wrapper so a narrow phone can't force the whole page sideways.
writeFileSync(join(ROOT, "docs/privacy.html"), html.replace(/<table>/g, '<div class="tw"><table>').replace(/<\/table>/g, "</table></div>"));
console.log("docs/privacy.html ← docs/PRIVACY.md");
