// Tiny, safe markdown → HTML for SAM's replies.
// Escapes first (no injection), then applies a small set of formats:
// **bold**, *italic*, `code`, links, and - / 1. lists.

// Escape ALL five HTML-sensitive chars. The quotes matter: the link/image rules below
// interpolate URLs and alt-text into HTML *attributes*, so an unescaped " or ' in model
// output (e.g. echoed from a malicious web page) could break out of src="…" and inject an
// event handler (onerror=…) → XSS with full local-API access. Escaping " and ' closes that.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/g, '<img class="md-img" src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])((https?:\/\/[^\s<)]+))/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}

// Lightweight, dependency-free syntax highlighting for fenced code blocks.
// Runs on already-escaped code; single-pass alternation (first-match-wins) so a
// keyword inside a string/comment isn't wrongly highlighted. Covers the common
// languages SAM emits (JS/TS/Python/shell/JSON/etc.).
// NOTE: runs AFTER escapeHtml, so string literals are &quot;…&quot; / &#39;…&#39;, not "…"/'…'.
const HL = /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|(&quot;.*?&quot;|&#39;.*?&#39;|`[^`]*`)|\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|import|export|from|default|class|extends|new|this|super|async|await|try|catch|finally|throw|typeof|instanceof|yield|def|lambda|print|echo|func|package|public|private|protected|static|void|type|interface|enum|struct|true|false|null|None|True|False|undefined|and|or|not|in|of|with|as|pass)\b|(\b\d+\.?\d*\b)/g;
function highlight(code: string): string {
  return code.replace(HL, (m, c, s, k, n) =>
    c ? `<span class="tok-c">${c}</span>` :
    s ? `<span class="tok-s">${s}</span>` :
    k ? `<span class="tok-k">${k}</span>` :
    n ? `<span class="tok-n">${n}</span>` : m
  );
}

export function renderMarkdown(text: string): string {
  // Pull out ```fenced code blocks``` first (highlighted, with a language tag).
  const parts = (text || "").split("```");
  if (parts.length > 1) {
    let html = "";
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) {
        const lang = (parts[i].match(/^([a-zA-Z0-9+#.]*)\n/) || [undefined, ""])[1] || "";
        const code = escapeHtml(parts[i].replace(/^[a-zA-Z0-9+#.]*\n/, ""));
        html += `<div class="code-wrap"><button class="code-copy" type="button" aria-label="Copy code">Copy</button><pre class="code"${lang ? ` data-lang="${lang}"` : ""}><code>${highlight(code)}</code></pre></div>`;
      } else html += renderBlock(parts[i]);
    }
    return html;
  }
  return renderBlock(text);
}

function renderBlock(text: string): string {
  const lines = escapeHtml(text || "").split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const quote = line.match(/^&gt;\s?(.*)$/);   // '>' is already HTML-escaped by now
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      closeList(); out.push("<hr>");
    } else if (heading) {
      closeList(); const h = heading[1].length + 1; out.push(`<h${h}>${inline(heading[2])}</h${h}>`);
    } else if (quote) {
      closeList(); out.push(`<blockquote>${inline(quote[1])}</blockquote>`);
    } else if (bullet) {
      if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; }
      out.push(`<li>${inline(bullet[1])}</li>`);
    } else if (numbered) {
      if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; }
      out.push(`<li>${inline(numbered[1])}</li>`);
    } else if (line.trim() === "") {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join("");
}
