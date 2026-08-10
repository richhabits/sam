// FILTERING THE TASK LIST, AND BEING HONEST ABOUT WHAT THE LIST IS.
//
// Tasks used to carry a "Now" section — Running / Queued / Failed / Done as four rows of dead
// numbers — above a list you could not filter. You could read "Failed 3" and have no way to
// reach those three except by scrolling. The count and the filter are the same control, which
// is the shape Manus uses, so the four rows collapse into one strip of chips.
//
// The trap this file exists to avoid: /api/yard reports ALL-TIME totals (store.summary()) but
// ships only the last 20 jobs (store.list(undefined, 20)). Labelling a chip with the all-time
// total would produce "Done 847" opening a list of twelve rows — a number that is wrong in the
// one place a person checks a number. So every count here is derived from the loaded rows, and
// the difference between the window and the whole is stated in words instead.

export type TaskState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

/** Live first, then wrong, then right, then abandoned — most-actionable to least. */
const ORDER: TaskState[] = ['running', 'queued', 'failed', 'done', 'cancelled'];

const LABEL: Record<TaskState, string> = {
  running: 'Running',
  queued: 'Queued',
  failed: 'Failed',
  done: 'Done',
  cancelled: 'Cancelled',
};

export type Filter = 'all' | TaskState;
export type Chip = { key: Filter; label: string; count: number };

/**
 * Which chips to show, in order, with the count each one actually reveals.
 *
 * A state appears only when the loaded rows contain it, so nobody scans past a permanent
 * "Cancelled 0". The one exception is the SELECTED chip, which is kept even at zero: a chip
 * that deletes itself the moment its last job changes state would move the strip under the
 * reader's finger and drop them somewhere they did not choose.
 */
export function taskFilters(jobs: { state: TaskState }[], selected: Filter): Chip[] {
  const n = (s: TaskState) => jobs.reduce((acc, j) => acc + (j.state === s ? 1 : 0), 0);
  const chips: Chip[] = [{ key: 'all', label: 'All', count: jobs.length }];
  for (const s of ORDER) {
    const count = n(s);
    if (count > 0 || selected === s) chips.push({ key: s, label: LABEL[s], count });
  }
  return chips;
}

export function applyFilter<T extends { state: TaskState }>(jobs: T[], filter: Filter): T[] {
  return filter === 'all' ? jobs : jobs.filter((j) => j.state === filter);
}

/**
 * What the list is a window onto, said plainly under it.
 *
 * Two facts can surprise someone reading a filtered list, and both are worth a sentence:
 * that the list is only the most recent slice of a much longer history, and that a job can be
 * running while sitting outside that slice — jobs come back newest-first by creation time, so
 * a long-running job started days ago genuinely falls off the end. Without the second clause
 * the Running chip appears to contradict the yard, and looks like a bug rather than a window.
 */
export function windowNote(
  loaded: { state: TaskState }[],
  totals: { queued: number; running: number; done: number; failed: number; cancelled: number },
): string {
  const all = totals.queued + totals.running + totals.done + totals.failed + totals.cancelled;
  const parts: string[] = [];
  if (all > loaded.length) parts.push(`The last ${loaded.length} of ${all} jobs.`);

  const runningHere = loaded.reduce((a, j) => a + (j.state === 'running' ? 1 : 0), 0);
  const missing = totals.running - runningHere;
  if (missing > 0) {
    parts.push(`${missing} more ${missing === 1 ? 'job is' : 'jobs are'} running, started too long ago to show here.`);
  }
  return parts.join(' ');
}
