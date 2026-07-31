// Answers come back as markdown, because the desk renders markdown (src/lib/md.ts). Shipping
// that raw to a phone means reading literal **stars** and ``` fences around every code block,
// which is what a lazy port looks like. RN has no innerHTML to lean on, so the text is turned
// into segments the view maps to <Text> runs — and that split is pure, so it can be tested from
// Node without a renderer.
//
// Deliberately small: bold, inline code, and fenced blocks are what a chat answer actually
// contains. Tables and images are not worth carrying on a 6-inch screen.

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'code'; text: string };

export type Block =
  | { kind: 'para'; segments: Segment[] }
  | { kind: 'codeblock'; text: string; lang?: string };

/** Split inline markers within one paragraph. Unmatched markers stay literal — a lone
 *  asterisk is far more often punctuation than a broken bold run. */
export function parseInline(line: string): Segment[] {
  const out: Segment[] = [];
  // `code` first: a marker inside backticks is content, not formatting.
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ kind: 'text', text: line.slice(last, m.index) });
    if (m[1]) out.push({ kind: 'code', text: m[1].slice(1, -1) });
    else if (m[2]) out.push({ kind: 'bold', text: m[2].slice(2, -2) });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ kind: 'text', text: line.slice(last) });
  return out.length ? out : [{ kind: 'text', text: line }];
}

/**
 * Split an answer into blocks. Runs on every token during streaming, so it stays a single
 * pass over the string with no allocation per character.
 *
 * An UNCLOSED fence still yields a code block: mid-stream the closing ``` has not arrived yet,
 * and rendering half a code block as prose makes the text jump when it lands.
 */
export function parseMarkdown(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.split('\n');
  let para: string[] = [];
  let code: string[] | null = null;
  let lang: string | undefined;

  const flushPara = () => {
    if (!para.length) return;
    const text = para.join('\n').trim();
    if (text) blocks.push({ kind: 'para', segments: parseInline(text) });
    para = [];
  };

  for (const line of lines) {
    const fence = line.match(/^\s*```(\w+)?\s*$/);
    if (fence) {
      if (code === null) {
        flushPara();
        code = [];
        lang = fence[1];
      } else {
        blocks.push({ kind: 'codeblock', text: code.join('\n'), lang });
        code = null;
        lang = undefined;
      }
      continue;
    }
    if (code !== null) code.push(line);
    else if (line.trim() === '') flushPara();
    else para.push(line);
  }

  if (code !== null) blocks.push({ kind: 'codeblock', text: code.join('\n'), lang });
  flushPara();
  return blocks;
}
