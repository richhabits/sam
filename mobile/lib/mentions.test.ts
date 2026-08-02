import { describe, it, expect } from 'vitest';
import {
  activeReferences,
  applyMention,
  buildReferencedMessage,
  findMention,
  matchTasks,
  mentionLabel,
  removeMention,
  taskContext,
  taskTitle,
  type RecentTask,
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
