import { describe, expect, it } from 'vitest';
import { drawsAsEmoji, GLYPHS } from './glyphs';
import { taskGlyph } from './mentions';

const entries = Object.entries(GLYPHS) as [string, string][];

describe('the glyph vocabulary', () => {
  // THE ASSERTION THIS FILE EXISTS FOR.
  //
  // It used to cover taskGlyph() alone, so the eight marks Settings grew and the nine the +
  // sheet grew were checked by hand instead. This walks the whole object, which means the next
  // mark added anywhere is checked by the suite rather than by whoever remembers.
  it('never picks a character iOS draws as a colour emoji', () => {
    for (const [name, glyph] of entries) {
      expect(drawsAsEmoji(glyph), `GLYPHS.${name} = ${glyph} renders as colour emoji on iOS`).toBe(false);
    }
  });

  it('gives every name a non-empty mark', () => {
    for (const [name, glyph] of entries) {
      expect(glyph.replace(/︎/g, '').length, `GLYPHS.${name} is empty`).toBeGreaterThan(0);
    }
  });

  // A glyph two characters wide breaks the 29pt tile it sits in, and the tile does not scale.
  it('is one visible character per mark', () => {
    for (const [name, glyph] of entries) {
      expect([...glyph.replace(/︎/g, '')].length, `GLYPHS.${name} is more than one character`).toBe(1);
    }
  });

  it('keeps the text-presentation selector on the emoji-capable marks that need it', () => {
    const TEXT = String.fromCharCode(0xfe0e);
    for (const name of ['build', 'create', 'edit', 'checkpoint', 'tools', 'videoGen'] as const) {
      expect(GLYPHS[name], `GLYPHS.${name} lost its U+FE0E`).toContain(TEXT);
    }
  });
});

describe('drawsAsEmoji — the rule itself', () => {
  it('catches the character that actually shipped and looked wrong', () => {
    expect(drawsAsEmoji('⏱')).toBe(true); // U+23F1, the stopwatch that ignored the tint
  });

  it('is not rescued by a text-presentation selector inside the ranges', () => {
    expect(drawsAsEmoji(`⏱${String.fromCharCode(0xfe0e)}`)).toBe(true);
  });

  it('catches the emoji planes proper', () => {
    expect(drawsAsEmoji('🔨')).toBe(true);
  });

  it('passes an emoji-CAPABLE character that is outside the default ranges', () => {
    expect(drawsAsEmoji('⚒')).toBe(false);
  });

  it('passes plain geometric and typographic marks', () => {
    for (const g of ['◈', '⇄', '▣', '♪', '✱', '◐', 'ⓘ', '?']) expect(drawsAsEmoji(g)).toBe(false);
  });
});

describe('the vocabulary and taskGlyph agree', () => {
  // Two screens showing the same idea with different marks is the thing a shared vocabulary is
  // for. A scheduled job in the + sheet and a sleep job in the task list are the same idea.
  it('uses one mark for elapsing time', () => {
    expect(GLYPHS.scheduled).toBe(GLYPHS.sleep);
    expect(taskGlyph('sleep')).toBe(GLYPHS.sleep);
  });

  it('uses one mark for building, in the sheet and in the list', () => {
    expect(GLYPHS.tools).toBe(GLYPHS.build);
    expect(taskGlyph('project.build')).toBe(GLYPHS.build);
  });

  // Every mark taskGlyph can return must be in the vocabulary, or the emoji rule above has a
  // hole exactly the size of the thing it was written to catch.
  it('returns nothing the vocabulary does not contain', () => {
    const known = new Set(Object.values(GLYPHS) as string[]);
    const kinds = [
      'project.build', 'project.create', 'project.edit', 'project.deploy', 'project.checkpoint',
      'project.restore', 'project.loop', 'run', 'playbook.run', 'sleep',
      'notebook.append', 'standing.watch', 'project.unheard-of', 'nothing.known', null, undefined,
    ];
    for (const k of kinds) {
      expect(known.has(taskGlyph(k)), `taskGlyph(${String(k)}) = ${taskGlyph(k)} is not in GLYPHS`).toBe(true);
    }
  });
});
