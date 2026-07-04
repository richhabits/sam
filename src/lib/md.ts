// Tiny, safe markdown → HTML for SAM's replies.
// Escapes first (no injection), then applies a small set of formats:
// **bold**, *italic*, `code`, links, and - / 1. lists.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])((https?:\/\/[^\s<)]+))/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}

export function renderMarkdown(text: string): string {
  // Pull out ```fenced code blocks``` first (rendered verbatim).
  const parts = (text || "").split("```");
  if (parts.length > 1) {
    let html = "";
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 1) html += `<pre class="code"><code>${escapeHtml(parts[i].replace(/^[a-zA-Z0-9]*\n/, ""))}</code></pre>`;
      else html += renderBlock(parts[i]);
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
