import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, Text, View } from 'react-native';
import { api } from './lib/api';
import { applyFilter, type Filter, taskFilters, windowNote } from './lib/filters';
import { elapsed, type JobStep, runLine } from './lib/fold';
import { GLYPHS } from './lib/glyphs';
import { type IOS, metrics, stateToneText, type } from './lib/ios';
import { taskGlyph, taskTitle } from './lib/mentions';
import { ActionRow, Chips, Row, Screen, Section } from './ui';

// THE TASKS SURFACE — every job SAM has run, as a native grouped list.

type Job = {
  id: string;
  kind: string;
  payload?: { name?: string; slug?: string; what?: string };
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  createdAt: number;
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

export default function TasksScreen({
  ios,
  onNeedsPairing,
  onOpenPairing,
}: {
  ios: IOS;
  onNeedsPairing: () => void;
  onOpenPairing?: () => void;
}) {
  const [yard, setYard] = useState<Yard | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const data = await api('/api/yard');
      setYard(data);
      setError('');
    } catch (e: any) {
      if (e?.status === 401) {
        setYard(null);
        return;
      }
      setError(e?.message || 'Standalone Mode');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const busy = (yard?.running ?? 0) > 0 || (yard?.queued ?? 0) > 0;
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!busy) return;
    const poll = setInterval(() => loadRef.current(), 5000);
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

  return (
    <Screen
      ios={ios}
      title="Tasks"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={ios.secondaryLabel} />}
    >
      {!yard || error ? (
        <Section
          ios={ios}
          header="Desktop Yard"
          footer="Tasks, background builds, automated playbooks, and file sync run on your desktop hardware. Connect to your Mac or PC to monitor them live from your phone."
        >
          <Row
            ios={ios}
            glyph={GLYPHS.tasks}
            title="Desktop Node"
            value="Not connected"
          />
          <ActionRow
            ios={ios}
            title="Connect to Mac / PC"
            onPress={() => onOpenPairing?.()}
            last
          />
        </Section>
      ) : null}

      {yard && !yard.on ? (
        <Section ios={ios} footer="Turn the yard on from SAM on your Mac and jobs will appear here.">
          <Row ios={ios} title="The yard is off" last />
        </Section>
      ) : null}

      {yard?.on ? (
        <>
          {rows.length || filter !== 'all' ? (
            <View style={{ marginTop: 2, marginBottom: 12 }}>
              <Chips ios={ios} options={chips} value={filter} onChange={setFilter} label="Filter tasks" />
            </View>
          ) : null}

          <Section ios={ios} footer={windowNote(yard.recent ?? [], yard) || undefined}>
            {!yard.recent?.length ? (
              <Row ios={ios} title="Nothing has run yet" last />
            ) : !rows.length ? (
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

function subtitleFor(j: Job, now: number): string {
  const line = runLine(j);
  const parts: string[] = [];
  if (line) parts.push(line);

  if (j.state === 'running' || j.state === 'queued') {
    const t = elapsed(j, now);
    if (t) parts.push(t);
  } else {
    if (!line) parts.push(new Date(j.createdAt).toLocaleString());
    if (j.costTokens) parts.push(`${j.costTokens} tokens`);
  }
  return parts.join(' · ');
}

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
