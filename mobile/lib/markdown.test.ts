import { describe, it, expect } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';
import { bound } from './thread';

describe('parseInline', () => {
  it('splits bold and inline code out of plain text', () => {
    expect(parseInline('run **now** with `npm test`')).toEqual([
      { kind: 'text', text: 'run ' },
      { kind: 'bold', text: 'now' },
      { kind: 'text', text: ' with ' },
      { kind: 'code', text: 'npm test' },
    ]);
  });

  it('treats a marker INSIDE backticks as content, not formatting', () => {
    expect(parseInline('`a ** b`')).toEqual([{ kind: 'code', text: 'a ** b' }]);
  });

  it('leaves an unmatched marker literal — a lone asterisk is usually punctuation', () => {
    expect(parseInline('2 * 3 = 6')).toEqual([{ kind: 'text', text: '2 * 3 = 6' }]);
  });
});

describe('parseMarkdown', () => {
  it('separates paragraphs from fenced code, keeping the language', () => {
    const blocks = parseMarkdown('Try this:\n\n```ts\nconst a = 1;\n```\n\nDone.');
    expect(blocks.map((b) => b.kind)).toEqual(['para', 'codeblock', 'para']);
    expect(blocks[1]).toEqual({ kind: 'codeblock', text: 'const a = 1;', lang: 'ts' });
  });

  // Mid-stream the closing fence has not arrived yet. Rendering the half-block as prose and
  // then reflowing it into a code block when the fence lands makes the answer visibly jump.
  it('renders an UNCLOSED fence as a code block while it is still streaming', () => {
    const blocks = parseMarkdown('Here:\n```js\nconst x = 2;');
    expect(blocks[1]).toEqual({ kind: 'codeblock', text: 'const x = 2;', lang: 'js' });
  });

  it('never returns an empty paragraph for blank lines', () => {
    expect(parseMarkdown('a\n\n\n\nb').map((b) => b.kind)).toEqual(['para', 'para']);
  });
});

describe('bound — the Keychain is not a database', () => {
  it('keeps the NEWEST turns when there are too many', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ role: 'user' as const, text: `m${i}` }));
    const kept = bound(many);
    expect(kept.length).toBeLessThanOrEqual(40);
    expect(kept[kept.length - 1].text).toBe('m59'); // the end of the conversation survives
  });

  it('drops from the FRONT when the text is too long, never mid-thread', () => {
    const huge = [
      { role: 'user' as const, text: 'x'.repeat(13_000) }, // alone, over the 12k cap
      { role: 'sam' as const, text: 'the newest answer' },
    ];
    const kept = bound(huge);
    expect(kept).toEqual([{ role: 'sam', text: 'the newest answer' }]);
  });

  it('leaves a small thread completely alone', () => {
    const small = [{ role: 'user' as const, text: 'hi' }, { role: 'sam' as const, text: 'hello' }];
    expect(bound(small)).toEqual(small);
  });
});
