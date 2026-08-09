import { describe, expect, it } from 'vitest';
import { elapsed, foldSteps, type JobStep, runLine, stepIdentity } from './fold';

const step = (label: string, state: JobStep['state'] = 'done', error?: string): JobStep => ({
  label,
  state,
  at: 1,
  ...(error ? { error } : {}),
});

describe('stepIdentity — what "the same thing twice" means', () => {
  it('reads through the verb, so a step reported live and again on completion is ONE thing', () => {
    expect(stepIdentity('Reading src/App.tsx')).toBe(stepIdentity('Read src/App.tsx'));
  });

  it('prefers a path when the label carries one', () => {
    expect(stepIdentity('Editing mobile/lib/fold.ts now')).toBe('mobile/lib/fold.ts');
  });

  it('prefers a quoted name over the surrounding prose', () => {
    expect(stepIdentity('Building "teahouse"')).toBe('teahouse');
  });

  it('never returns empty, even for a label that is nothing but a verb', () => {
    expect(stepIdentity('Reading')).toBeTruthy();
    expect(stepIdentity('read')).toBeTruthy();
  });
});

describe('foldSteps — the three rules', () => {
  // RULE 1. This is the whole point: a job that touched three files forty times did three
  // things, and a summary that says forty is worse than no summary.
  it('de-duplicates by identity, not by call', () => {
    const steps = [
      ...Array(20).fill(null).map(() => step('Read src/App.tsx')),
      ...Array(15).fill(null).map(() => step('Read src/ui.tsx')),
      step('Read src/lib/fold.ts'),
    ];
    expect(foldSteps(steps)).toBe('Read 3 files');
  });

  // RULE 2. Past the threshold the number stops carrying information and is dropped.
  it('saturates rather than printing a big number', () => {
    const many = Array(47)
      .fill(null)
      .map((_, i) => step(`Read file${i}.ts`));
    const folded = foldSteps(many);
    expect(folded).toBe('Read the project');
    expect(folded).not.toMatch(/\d/);
  });

  it('still counts below the threshold, and gets the singular right', () => {
    expect(foldSteps([step('Read one.ts')])).toBe('Read 1 file');
    expect(foldSteps([step('Read one.ts'), step('Read two.ts')])).toBe('Read 2 files');
  });

  // RULE 3.
  it('caps at three phrases however many kinds of work happened', () => {
    const steps = [
      step('Read a.ts'),
      step('Edited b.ts'),
      step('Ran the build'),
      step('Deployed to production'),
      step('Ran the tests'),
    ];
    expect(foldSteps(steps).split(' · ')).toHaveLength(3);
  });

  it('joins with a middot, so the line reads as one thing', () => {
    expect(foldSteps([step('Read a.ts'), step('Deployed it')])).toBe('Read 1 file · Deployed');
  });

  // The honest-degradation rule. A job the yard finished before it recorded steps has nothing
  // to fold, and inventing a summary for it would be the one thing this must never do.
  it('returns EMPTY rather than inventing a summary when there are no steps', () => {
    expect(foldSteps([])).toBe('');
    expect(foldSteps(undefined)).toBe('');
    expect(foldSteps(null)).toBe('');
  });

  it('survives a malformed step without taking the row down with it', () => {
    expect(foldSteps([{ label: '', state: 'done' }, step('Read a.ts')])).toBe('Read 1 file');
  });

  it('keeps an uncategorised label rather than dropping the work on the floor', () => {
    expect(foldSteps([step('Warmed up the copy')])).toBe('Warmed up the copy');
  });
});

describe('runLine — tense is the state machine', () => {
  it('a running job reports the step that is actually in flight, in present continuous', () => {
    const line = runLine({
      state: 'running',
      steps: [step('Install dependencies'), step('Build the project', 'running')],
    });
    expect(line).toBe('Building the project…');
  });

  // The bug this ordering exists to prevent: a failed step followed by a running one would
  // otherwise report the failure as the current activity.
  it('never reports a finished or failed step as the current one', () => {
    const line = runLine({
      state: 'running',
      steps: [step('Run the tests', 'failed', 'exit 1'), step('Retry the tests', 'running')],
    });
    expect(line).toBe('Retrying the tests…');
  });

  it('does not double the -ing on a label that is already present continuous', () => {
    expect(runLine({ state: 'running', steps: [step('Reading the repo', 'running')] })).toBe('Reading the repo');
  });

  it('a failed job leads with the step that broke and its own error', () => {
    expect(
      runLine({ state: 'failed', steps: [step('Install', 'done'), step('Build', 'failed', 'exit 1')] }),
    ).toBe('Build — exit 1');
  });

  it('falls back to the job error when no step recorded the failure', () => {
    expect(runLine({ state: 'failed', steps: [], lastError: 'the host refused the upload' })).toBe(
      'the host refused the upload',
    );
  });

  it('gives blocked and stopped their own words rather than dressing them as running', () => {
    expect(runLine({ state: 'queued', steps: [] })).toBe('Waiting to start');
    expect(runLine({ state: 'cancelled', steps: [] })).toBe('Stopped');
  });

  it('a finished job folds, which is the whole point', () => {
    expect(runLine({ state: 'done', steps: [step('Read a.ts'), step('Deployed it')] })).toBe(
      'Read 1 file · Deployed',
    );
  });

  it('says nothing rather than something empty when a job has no steps at all', () => {
    expect(runLine({ state: 'done', steps: [] })).toBe('');
    expect(runLine({ state: 'running', steps: [] })).toBe('');
  });
});

describe('elapsed — a clock that tells the truth', () => {
  it('counts from the start while a job runs', () => {
    expect(elapsed({ startedAt: 0 }, 45_000)).toBe('45s');
    expect(elapsed({ startedAt: 0 }, 134_000)).toBe('2m 14s');
    expect(elapsed({ startedAt: 0 }, 3_900_000)).toBe('1h 5m');
  });

  // The reason this takes `now`: once a job finishes its duration is a fact, and a formatter
  // that keeps reading the clock would keep growing it.
  it('freezes at the finish, so a done job stops ageing', () => {
    const job = { startedAt: 0, finishedAt: 60_000 };
    expect(elapsed(job, 60_000)).toBe('1m 0s');
    expect(elapsed(job, 999_999_999)).toBe('1m 0s');
  });

  it('falls back to createdAt for a job that never recorded a start', () => {
    expect(elapsed({ createdAt: 0, startedAt: null }, 5_000)).toBe('5s');
  });

  // A phone and a Mac disagreeing about the clock must not render "-3s".
  it('says nothing rather than counting backwards', () => {
    expect(elapsed({ startedAt: 10_000 }, 5_000)).toBe('');
    expect(elapsed({ startedAt: null, createdAt: null })).toBe('');
  });
});
