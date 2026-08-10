import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, Text, View } from 'react-native';
import { api } from './lib/api';
import { applyFilter, type Filter, taskFilters, windowNote } from './lib/filters';
import { elapsed, type JobStep, runLine } from './lib/fold';
import { type IOS, metrics, stateToneText, type } from './lib/ios';
import { taskGlyph, taskTitle } from './lib/mentions';
import { Chips, Row, Screen, Section } from './ui';

// THE TASKS SURFACE — every job SAM has run, as a native grouped list.
//
// Reads the same /api/yard the desk's TasksView reads, so the two never disagree about what
// happened. Read-only from the simulator by design: assigning work is isYardTrusted, which on
// loopback wants the desktop passkey a phone cannot hold (a real device over the LAN is a
// paired session and passes).

type Job = {
  id: string;
  kind: string;
  payload?: { name?: string; slug?: string; what?: string };
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  createdAt: number;
  // The yard has recorded these on every job all along (server/yard/store.ts) and /api/yard's
  // `recent` carries them, because list() hydrates whole rows. The phone was throwing them away
  // and printing a timestamp instead.
  startedAt?: number | null;
  finishedAt?: number | null;
  steps?: JobStep[];
  costTokens?: number;
  project?: string | null;
  lastError?: string | null;
};

type Yard = {
  on: boolean;
  queued: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
  recent: Job[];
  meter?: { todayTokens?: number; weekTokens?: number };
};

// The naming lives in lib/mentions.ts (taskTitle) because the @ picker needs the SAME string —
// a job called "Build: mainline" in this list and something else in a reference is how two
// screens start disagreeing about what happened. taskGlyph is there for the same reason: the
// leading tile says what KIND of job a row is, and state stays where it already was, in the
// coloured word on the right.

export default function TasksScreen({ ios, onNeedsPairing }: { ios: IOS; onNeedsPairing: () => void }) {
  const [yard, setYard] = useState<Yard | null>(null);
  const [error, setError] = useState('');

  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  // Ticks only while something is actually running — see the effect below.
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      setYard(await api('/api/yard'));
      setError('');
    } catch (e: any) {
      if (e?.status === 401) return onNeedsPairing();
      setError(e?.message || 'could not reach the yard');
    }
  }, [onNeedsPairing]);

  useEffect(() => {
    load();
  }, [load]);

  // A SCREEN TITLED "NOW" WAS A SNAPSHOT.
  //
  // load() ran once on mount and never again — not on returning to the tab, not while a job
  // ran. "Running 1" could sit there for an hour after the job finished, and the only way to
  // find out was to kill the app. A live queue that does not update is worse than no queue,
  // because it looks authoritative.
  //
  // Two fixes, both cheap and local. Pull-to-refresh, because that is the gesture an iOS user
  // already tries here. And a poll that exists ONLY while the yard says something is running,
  // cancelling itself the moment nothing is — so an idle phone does no work, which matters for
  // a screen someone leaves open.
  const busy = (yard?.running ?? 0) > 0 || (yard?.queued ?? 0) > 0;
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!busy) return;
    const poll = setInterval(() => loadRef.current(), 5000);
    // The clock is separate and faster: elapsed time changes every second, the job list does
    // not, and refetching once a second to move a counter would be absurd.
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [busy]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const chips = taskFilters(yard?.recent ?? [], filter);
  const rows = applyFilter(yard?.recent ?? [], filter);

  if (!yard && !error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: ios.groupedBg }}>
        <ActivityIndicator color={ios.tint} />
      </View>
    );
  }

  return (
    <Screen
      ios={ios}
      title="Tasks"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ios.secondaryLabel} />}
    >
      {error ? (
        <Section ios={ios}>
          <Row ios={ios} title={error} destructive last />
        </Section>
      ) : null}

      {yard && !yard.on ? (
        <Section ios={ios} footer="Turn the yard on from SAM on your Mac and jobs will appear here.">
          <Row ios={ios} title="The yard is off" last />
        </Section>
      ) : null}

      {yard?.on ? (
        <>
          {/* THE STRIP REPLACES THE "NOW" SECTION THAT USED TO LEAD THIS SCREEN.
              Running / Queued / Failed / Done were four rows of numbers you could read but not
              act on — "Failed 3" with no way to reach those three. Chips carry the same counts
              and open the rows behind them, so one control does what two were half-doing. It
              sits outside the Section because a full-bleed horizontal scroll inside an inset
              card would clip its own ends.

              It leads, and Cost moved BELOW the list, because a filter has to touch the thing
              it filters. Rendered under Cost it read as part of Cost — the eye groups by
              proximity before it reads a header, so the control looked like it belonged to the
              token meter it happened to sit beneath. */}
          {rows.length || filter !== 'all' ? (
            <View style={{ marginTop: 2, marginBottom: 12 }}>
              <Chips ios={ios} options={chips} value={filter} onChange={setFilter} label="Filter tasks" />
            </View>
          ) : null}

          <Section ios={ios} footer={windowNote(yard.recent ?? [], yard) || undefined}>
            {!yard.recent?.length ? (
              <Row ios={ios} title="Nothing has run yet" last />
            ) : !rows.length ? (
              // Reachable because the selected chip survives its own count hitting zero. Naming
              // the filter is the difference between "this is empty" and "this is broken".
              <Row ios={ios} title={`No ${filter} tasks in the last ${yard.recent.length}`} last />
            ) : (
              rows.map((j, i) => (
                <Row
                  key={j.id}
                  ios={ios}
                  title={taskTitle(j)}
                  glyph={taskGlyph(j.kind)}
                  subtitle={subtitleFor(j, now)}
                  accessory={<StateAccessory ios={ios} state={j.state} />}
                  last={i === rows.length - 1}
                />
              ))
            )}
          </Section>

          {/* Below the list on purpose. It is the answer to "what did this cost", which is a
              question you ask after reading what ran — not the reason anyone opens a screen
              called Tasks. */}
          {yard.meter ? (
            <Section
              ios={ios}
              header="Cost"
              footer="SAM routes to a free or local brain first — this is what everything actually cost."
            >
              <Row ios={ios} title="Today" value={`${yard.meter.todayTokens ?? 0} tokens`} />
              <Row ios={ios} title="This week" value={`${yard.meter.weekTokens ?? 0} tokens`} last />
            </Section>
          ) : null}
        </>
      ) : null}

      <View style={{ height: metrics.margin }} />
    </Screen>
  );
}

/**
 * WHAT THE ROW SAYS UNDER THE TITLE.
 *
 * Was `8/9/2026, 12:04:49 AM · 1840 tokens` — a receipt. When did it happen and what did it
 * cost, and nothing at all about what it WAS. Now the job's own step list does the talking,
 * folded (lib/fold.ts), with the timestamp kept only where it is still the most useful fact.
 *
 * The fallback is the important part. foldSteps() returns '' rather than inventing a summary
 * for a job that recorded no steps — every job the yard finished before it learned to record
 * them — and those rows must keep exactly what they had. A design that only works on new data
 * and blanks the history is not an improvement.
 */
function subtitleFor(j: Job, now: number): string {
  const line = runLine(j);
  const parts: string[] = [];
  if (line) parts.push(line);

  // A running job's most useful second fact is how long it has been going: "2m 14s" tells you
  // whether it is working or stuck, which a start time does not. A finished job's is when.
  if (j.state === 'running' || j.state === 'queued') {
    const t = elapsed(j, now);
    if (t) parts.push(t);
  } else {
    if (!line) parts.push(new Date(j.createdAt).toLocaleString());
    if (j.costTokens) parts.push(`${j.costTokens} tokens`);
  }
  return parts.join(' · ');
}

/**
 * THE NO-REFLOW STATUS SLOT.
 *
 * A fixed 20pt box ahead of the state word, holding an activity indicator while a job runs and
 * nothing at all once it stops. Fixed, because the alternative is a row that jumps sideways the
 * moment a job finishes — and this list now polls every five seconds, so that would happen
 * under the reader's eyes. Manus reserves exactly this footprint for exactly this reason.
 *
 * The spinner is also where "running" went after it stopped being terracotta. Motion carries
 * liveness better than colour: a coloured word reads the same whether a job is working or
 * wedged, and a spinner that is turning does not. iOS uses an activity indicator for this
 * everywhere, so it costs nothing against the 4.2 argument either.
 *
 * The word stays, and stays the accessible one — VoiceOver reads "running", not "spinner".
 */
function StateAccessory({ ios, state }: { ios: IOS; state: Job['state'] }) {
  const running = state === 'running';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 8 }}>
      <View style={{ width: 20, alignItems: 'center' }}>
        {running ? <ActivityIndicator size="small" color={ios.secondaryLabel} /> : null}
      </View>
      <Text style={[type.footnote, { color: stateToneText(state, ios), fontWeight: '600' }]}>{state}</Text>
    </View>
  );
}
