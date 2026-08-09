import { describe, expect, it } from 'vitest';
import {
  activeReferences,
  applyMention,
  buildReferencedMessage,
  findMention,
  matchTasks,
  mentionLabel,
  type RecentTask,
  removeMention,
  taskContext,
  taskGlyph,
  taskTitle,
  taskWhen,
} from './mentions';

const job = (over: Partial<RecentTask> = {}): RecentTask => ({
  id: 'job_abc',
  kind: 'project.build',
  payload: { name: 'mainline' },
  state: 'failed',
  createdAt: Date.UTC(2026, 7, 1, 9, 30),
  ...over,
});

describe('findMention — when the picker is allowed to open', () => {
  it('opens on a bare @ at the start of the box', () => {
    expect(findMention('@')).toEqual({ start: 0, query: '' });
  });

  it('opens after whitespace, and carries what has been typed since', () => {
    expect(findMention('why did @main')).toEqual({ start: 8, query: 'main' });
    expect(findMention('line one\n@dep')).toEqual({ start: 9, query: 'dep' });
  });

  // The whole reason this is a function and not an `includes('@')`. Both of these fire on
  // every keystroke of an ordinary sentence, and a task list over the keyboard while you are
  // typing an address is the fastest way to make somebody turn a feature off.
  it('NEVER opens inside an email address', () => {
    expect(findMention('mail romeo@example.com')).toBeNull();
    expect(findMention('romeo@')).toBeNull();
  });

  it('NEVER opens mid-word', () => {
    expect(findMention('npm i react@18')).toBeNull();
    expect(findMention('foo@bar')).toBeNull();
  });

  it('closes again as soon as whitespace follows the @', () => {
    expect(findMention('@ ')).toBeNull();
    expect(findMention('@build then deploy')).toBeNull();
  });

  it('gives up once the "query" is prose rather than a search', () => {
    expect(findMention(`@${'x'.repeat(33)}`)).toBeNull();
  });

  it('reads from the CARET, not the end — editing earlier in the box still works', () => {
    // caret sits right after "@ma"; "and ship it" is the tail of an already-typed sentence
    expect(findMention('why did @ma and ship it', 11)).toEqual({ start: 8, query: 'ma' });
  });

  it('tracks the LAST @ when there are several', () => {
    expect(findMention('@Build: mainline and @dep')).toEqual({ start: 21, query: 'dep' });
  });
});

describe('applyMention', () => {
  it('swaps the half-typed query for the label and reports where the caret lands', () => {
    const m = findMention('why did @main')!;
    expect(applyMention('why did @main', m, 'Build: mainline')).toEqual({
      text: 'why did @Build: mainline ',
      cursor: 25,
    });
  });

  // The trailing space is the picker's own off-switch. Without it the inserted label is itself
  // a live mention, and the list re-opens on top of the task you just picked.
  it('leaves the box in a state where NO mention is open', () => {
    const m = findMention('@dep')!;
    const after = applyMention('@dep', m, 'Deploy mainline');
    expect(findMention(after.text, after.cursor)).toBeNull();
  });

  it('closes the picker even for a single-word label, which has no space of its own', () => {
    const m = findMention('@run')!;
    const after = applyMention('@run', m, 'run');
    expect(findMention(after.text, after.cursor)).toBeNull();
  });

  it('keeps whatever was already after the caret, and reuses its space', () => {
    const m = findMention('tell me about @ma later', 17)!;
    const after = applyMention('tell me about @ma later', m, 'Build: mainline', 17);
    expect(after.text).toBe('tell me about @Build: mainline later');
    expect(findMention(after.text, after.cursor)).toBeNull();
  });
});

describe('removeMention', () => {
  it('takes the token back out, space and all', () => {
    expect(removeMention('why did @Build: mainline fail', 'Build: mainline')).toBe('why did fail');
  });

  it('removes ONE occurrence, so a doubled reference loses only the tapped chip', () => {
    expect(removeMention('@run and @run', 'run')).toBe('and @run');
  });

  it('leaves a message that no longer mentions it alone', () => {
    expect(removeMention('nothing here', 'Build: mainline')).toBe('nothing here');
  });
});

describe('taskTitle / mentionLabel', () => {
  it('names a job the way the Tasks list already names it', () => {
    expect(taskTitle(job())).toBe('Build: mainline');
    expect(taskTitle(job({ kind: 'project.deploy', payload: { slug: 'cafe' } }))).toBe('Deploy cafe');
    expect(taskTitle(job({ kind: 'run', payload: {}, project: 'sam' }))).toBe('run · sam');
  });

  // A label goes back INTO the box, so it must not contain the two characters that would break
  // the box: a newline splits the token, a second @ starts a mention inside this one.
  it('strips newlines and @ out of a label', () => {
    expect(mentionLabel(job({ kind: 'a\nb @c', payload: {}, project: null }))).toBe('a b c');
  });

  it('falls back to the id rather than producing an empty label', () => {
    expect(mentionLabel(job({ kind: '@@', payload: {}, project: null }))).toBe('job_abc');
  });
});

describe('taskGlyph', () => {
  it('gives each kind of work its own mark', () => {
    const kinds = ['project.build', 'project.create', 'project.edit', 'project.deploy', 'project.checkpoint', 'project.restore'];
    const glyphs = kinds.map(taskGlyph);
    expect(new Set(glyphs).size).toBe(kinds.length);
  });

  // THE TEST THAT SHOULD HAVE EXISTED FIRST.
  //
  // taskGlyph knew six kinds; server/yard/worker.ts registers ten. The four it missed included
  // project.loop, the commonest job there is and one that sits in the demo fixtures — so every
  // screenshot of the Tasks list showed the fallback triangle next to it. Nothing failed,
  // because nothing was checking the two lists against each other.
  //
  // This list is the server's, copied deliberately rather than imported: mobile/ does not build
  // against server/, and a hand-copied list that a test enforces is honest, where a silent
  // divergence is not. If a handler is added there and not here, this test is where it surfaces.
  const YARD_KINDS = [
    'project.build',
    'project.create',
    'project.edit',
    'project.deploy',
    'project.checkpoint',
    'project.restore',
    'project.loop',
    'playbook.run',
    'run',
    'sleep',
  ];

  it('has a real mark for every kind the yard can actually dispatch — no fallbacks', () => {
    const FALLBACK = taskGlyph('something.nobody.registered');
    for (const kind of YARD_KINDS) {
      expect(taskGlyph(kind), `${kind} fell through to the generic mark`).not.toBe(FALLBACK);
    }
  });

  it('gives all ten of them distinct marks, so the list can be scanned', () => {
    const glyphs = YARD_KINDS.map(taskGlyph);
    expect(new Set(glyphs).size).toBe(YARD_KINDS.length);
  });

  // ↺ and ⟳ are the same arrow in opposite directions and sit on adjacent rows in a real yard
  // list. If they ever collapse to the same character the list silently stops distinguishing
  // "put it back" from "keep going".
  it('keeps restore and loop pointing opposite ways', () => {
    expect(taskGlyph('project.restore')).not.toBe(taskGlyph('project.loop'));
  });

  // NO GLYPH MAY DEFAULT TO COLOUR EMOJI.
  //
  // These ranges are the ones Unicode gives Emoji_Presentation by default, so iOS draws them
  // full-colour and they ignore tintText completely. `sleep` shipped as ⏱ (U+23F1) and rendered
  // as a photographic stopwatch sitting in a column of terracotta marks — measured at chroma 3
  // against 120–154 for every neighbour. Nothing failed; it just looked wrong, and only on a
  // device.
  //
  // U+FE0E is not a reliable rescue inside these ranges on iOS, so the rule is to stay out of
  // them entirely rather than to decorate a bad choice with a selector.
  const EMOJI_DEFAULT_RANGES: [number, number][] = [
    [0x231a, 0x23ff], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653],
    [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab],
    [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4],
    [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa],
    [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
    [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757],
    [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c],
    [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  ];

  it('never picks a character that iOS draws as a colour emoji', () => {
    for (const kind of [...YARD_KINDS, 'notebook.x', 'standing.x', 'nothing.known']) {
      for (const ch of taskGlyph(kind)) {
        const cp = ch.codePointAt(0) ?? 0;
        if (cp === 0xfe0e) continue;
        expect(cp, `${kind} uses U+${cp.toString(16)}, which is in an emoji plane`).toBeLessThan(0x1f000);
        for (const [lo, hi] of EMOJI_DEFAULT_RANGES) {
          expect(
            cp >= lo && cp <= hi,
            `${kind} uses U+${cp.toString(16).toUpperCase()}, inside emoji-presentation range U+${lo.toString(16).toUpperCase()}–U+${hi.toString(16).toUpperCase()}`,
          ).toBe(false);
        }
      }
    }
  });

  // The point of the family fallback: a kind nobody has taught this function still lands
  // somewhere better than the generic bullet if its prefix is one we know.
  it('falls back by family before giving up', () => {
    expect(taskGlyph('notebook.append')).toBe(taskGlyph('notebook.anything'));
    expect(taskGlyph('notebook.append')).not.toBe(taskGlyph('standing.watch'));
    expect(taskGlyph('standing.watch')).not.toBe(taskGlyph('something.else'));
  });

  it('always returns a mark, even for a job with no kind at all', () => {
    for (const k of [null, undefined, '', 'run', 'project.build']) {
      expect(taskGlyph(k).length).toBeGreaterThan(0);
    }
  });

  // U+FE0E is what stops iOS drawing several of these as colour emoji. Losing it is invisible
  // in a diff and very visible on a phone, so it is asserted rather than trusted. Built from a
  // code point rather than pasted, because an invisible character in a test literal is exactly
  // the thing an editor or a formatter eats without anyone noticing.
  it('keeps the text-presentation selector on the glyphs that need it', () => {
    const textPresentation = String.fromCharCode(0xfe0e);
    for (const k of ['project.build', 'project.create', 'project.edit', 'project.checkpoint']) {
      expect(taskGlyph(k)).toContain(textPresentation);
    }
  });
});

describe('matchTasks', () => {
  const list = [
    job({ id: 'a', payload: { name: 'mainline' }, createdAt: 1 }),
    job({ id: 'b', payload: { name: 'piing' }, createdAt: 3 }),
    job({ id: 'c', kind: 'project.deploy', payload: { slug: 'mainline-web' }, createdAt: 2 }),
  ];

  it('shows the newest first when nothing has been typed yet', () => {
    expect(matchTasks(list, '').map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('matches anywhere in the title, not just the start', () => {
    expect(matchTasks(list, 'main').map((t) => t.id)).toEqual(['c', 'a']);
  });

  it('is case-insensitive and honours the limit', () => {
    expect(matchTasks(list, 'MAIN', 1).map((t) => t.id)).toEqual(['c']);
  });

  it('returns nothing rather than everything when the query matches nothing', () => {
    expect(matchTasks(list, 'zzz')).toEqual([]);
  });
});

describe('taskContext', () => {
  it('works from the summary row alone — an unreachable server must not empty a reference', () => {
    const ctx = taskContext(job({ lastError: 'npm run build exited 1' }));
    expect(ctx).toContain('Task "Build: mainline" (job_abc)');
    expect(ctx).toContain('state: failed');
    expect(ctx).toContain('Error: npm run build exited 1');
  });

  it('adds the steps and the log when the detail call did land', () => {
    const ctx = taskContext(job(), {
      job: { ...job(), steps: [{ label: 'install', state: 'done' }, { label: 'build', state: 'failed', error: 'exit 1' }] },
      log: ['installing', 'building', 'FAILED'],
    });
    expect(ctx).toContain('Steps: install (done), build (failed: exit 1)');
    expect(ctx).toContain('Log (last 3 lines):');
    expect(ctx.endsWith('FAILED')).toBe(true);
  });

  // A build log is unbounded and a phone is on mobile data paying free-tier tokens. Cut from
  // the front: the end of a log is where the failure is.
  it('keeps the END of a long log and stays inside the budget', () => {
    const log = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    const ctx = taskContext(job(), { job: job(), log }, 400);
    expect(ctx.length).toBeLessThanOrEqual(400);
    expect(ctx).toContain('line 499');
    expect(ctx).not.toContain('line 0\n');
  });
});

describe('activeReferences / buildReferencedMessage', () => {
  const ref = { id: 'job_abc', label: 'Build: mainline', context: 'Task "Build: mainline" · state: failed' };

  it('drops a reference the operator backspaced out of the box', () => {
    expect(activeReferences('why did @Build: mainline fail', [ref])).toEqual([ref]);
    expect(activeReferences('why did it fail', [ref])).toEqual([]);
  });

  it('puts the context BEFORE the message and never edits the message itself', () => {
    const out = buildReferencedMessage('why did @Build: mainline fail', [ref]);
    expect(out.endsWith('why did @Build: mainline fail')).toBe(true);
    expect(out).toContain('Referenced task (context');
    expect(out).toContain('state: failed');
  });

  it('sends the message untouched when nothing is referenced', () => {
    expect(buildReferencedMessage('hello', [])).toBe('hello');
  });

  it('separates two references so they cannot read as one job', () => {
    const out = buildReferencedMessage('compare these', [ref, { ...ref, id: 'job_def', context: 'Task "Deploy cafe"' }]);
    expect(out).toContain('Referenced tasks (context');
    expect(out).toContain('\n---\n');
  });
});

describe('taskWhen', () => {
  const now = Date.UTC(2026, 7, 8, 12, 0, 0);
  const at = (ms: number) => taskWhen(now - ms, now);
  const SEC = 1000;
  const MIN = 60 * SEC;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it('says "just now" under a minute', () => {
    expect(at(0)).toBe('just now');
    expect(at(59 * SEC)).toBe('just now');
  });

  it('rounds down rather than ageing a job it has not seen age', () => {
    expect(at(MIN)).toBe('1m ago');
    expect(at(119 * SEC)).toBe('1m ago');
    expect(at(90 * MIN)).toBe('1h ago');
    expect(at(47 * HOUR)).toBe('1d ago');
  });

  it('steps up at each boundary exactly once', () => {
    expect(at(60 * MIN)).toBe('1h ago');
    expect(at(24 * HOUR)).toBe('1d ago');
    expect(at(6 * DAY)).toBe('6d ago');
  });

  it('falls back to a date once "days ago" stops being useful', () => {
    expect(at(7 * DAY)).toBe(new Date(now - 7 * DAY).toLocaleDateString());
  });

  it('never reads as the future when the phone and the Mac disagree on the clock', () => {
    expect(taskWhen(now + 4 * MIN, now)).toBe('just now');
  });

  it('says nothing at all when there is no timestamp', () => {
    expect(taskWhen(undefined, now)).toBe('');
    expect(taskWhen(null, now)).toBe('');
    expect(taskWhen(Number.NaN, now)).toBe('');
  });
});
