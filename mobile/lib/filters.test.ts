import { describe, expect, it } from 'vitest';
import { applyFilter, type Filter, type TaskState, taskFilters, windowNote } from './filters';

const j = (state: TaskState) => ({ state });
const totals = (o: Partial<Record<TaskState, number>>) => ({
  queued: 0,
  running: 0,
  done: 0,
  failed: 0,
  cancelled: 0,
  ...o,
});

describe('taskFilters — which chips exist', () => {
  it('always leads with All, counting every loaded row', () => {
    const chips = taskFilters([j('done'), j('failed'), j('done')], 'all');
    expect(chips[0]).toEqual({ key: 'all', label: 'All', count: 3 });
  });

  it('omits a state nobody has, so the strip is not padded with permanent zeroes', () => {
    const keys = taskFilters([j('done')], 'all').map((c) => c.key);
    expect(keys).toEqual(['all', 'done']);
    expect(keys).not.toContain('cancelled');
  });

  // The reason this rule exists: a chip that deletes itself when its last job changes state
  // moves the strip under the reader's finger and drops them on a filter they did not choose.
  it('keeps the SELECTED chip even when its count falls to zero', () => {
    const chips = taskFilters([j('done')], 'running');
    expect(chips.find((c) => c.key === 'running')).toEqual({ key: 'running', label: 'Running', count: 0 });
  });

  it('orders by how much the state asks of you — live, then wrong, then settled', () => {
    const rows = [j('cancelled'), j('done'), j('failed'), j('queued'), j('running')];
    expect(taskFilters(rows, 'all').map((c) => c.key)).toEqual([
      'all',
      'running',
      'queued',
      'failed',
      'done',
      'cancelled',
    ]);
  });

  // The whole point of the control. A count is only checkable if the list it opens matches it.
  it('every chip count equals the number of rows that chip actually opens', () => {
    const rows = [j('done'), j('done'), j('failed'), j('running')];
    for (const c of taskFilters(rows, 'all')) {
      expect(applyFilter(rows, c.key).length).toBe(c.count);
    }
  });

  it('survives an empty yard without inventing chips', () => {
    expect(taskFilters([], 'all')).toEqual([{ key: 'all', label: 'All', count: 0 }]);
  });
});

describe('applyFilter', () => {
  const rows = [j('done'), j('failed'), j('done')];

  it('all is a pass-through, not a copy that reorders', () => {
    expect(applyFilter(rows, 'all')).toEqual(rows);
  });

  it('narrows to exactly one state', () => {
    expect(applyFilter(rows, 'failed')).toEqual([j('failed')]);
  });

  it('returns nothing rather than everything when a state is absent', () => {
    expect(applyFilter(rows, 'cancelled')).toEqual([]);
  });
});

describe('windowNote — saying that the list is a window', () => {
  it('says nothing when the list is the whole history', () => {
    expect(windowNote([j('done'), j('failed')], totals({ done: 1, failed: 1 }))).toBe('');
  });

  it('names both the window and the whole, because "Done 12" under 847 jobs reads as a bug', () => {
    const loaded = Array.from({ length: 20 }, () => j('done'));
    expect(windowNote(loaded, totals({ done: 847 }))).toContain('The last 20 of 847 jobs.');
  });

  // A job started days ago is still running but sorts off the end of a newest-first window, so
  // the Running chip can honestly read 0 while the yard reports 2. Silence there looks like a
  // defect in the counter rather than a property of the list.
  it('accounts for a running job that falls outside the window', () => {
    const loaded = Array.from({ length: 20 }, () => j('done'));
    const note = windowNote(loaded, totals({ done: 847, running: 2 }));
    expect(note).toContain('2 more jobs are running');
  });

  it('speaks of one job in the singular', () => {
    const loaded = [j('done')];
    expect(windowNote(loaded, totals({ done: 5, running: 1 }))).toContain('1 more job is running');
  });

  it('never claims a negative when every running job is already visible', () => {
    const loaded = [j('running'), j('running')];
    expect(windowNote(loaded, totals({ running: 2 }))).not.toMatch(/-|more job/);
  });
});

describe('the chip set is exhaustive', () => {
  // A state with no chip is a state whose jobs are reachable only under All — findable by
  // scrolling, which is the thing this control was added to remove.
  it('gives every state SAM can record a chip of its own', () => {
    const every: TaskState[] = ['queued', 'running', 'done', 'failed', 'cancelled'];
    const keys = taskFilters(every.map(j), 'all').map((c) => c.key as Filter);
    for (const s of every) expect(keys).toContain(s);
  });
});
