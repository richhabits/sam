import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { api } from './lib/api';
import { type IOS, metrics, stateTone, type } from './lib/ios';
import { taskTitle } from './lib/mentions';
import { Row, Screen, Section } from './ui';

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
// screens start disagreeing about what happened.

export default function TasksScreen({ ios, onNeedsPairing }: { ios: IOS; onNeedsPairing: () => void }) {
  const [yard, setYard] = useState<Yard | null>(null);
  const [error, setError] = useState('');

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

  const tone = (state: Job['state']) => stateTone(state, ios);

  if (!yard && !error) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: ios.groupedBg }}>
        <ActivityIndicator color={ios.tint} />
      </View>
    );
  }

  return (
    <Screen ios={ios} title="Tasks">
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
          <Section ios={ios} header="Now">
            <Row ios={ios} title="Running" value={String(yard.running)} />
            <Row ios={ios} title="Queued" value={String(yard.queued)} />
            <Row ios={ios} title="Failed" value={String(yard.failed)} />
            <Row ios={ios} title="Done" value={String(yard.done)} last />
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

          <Section ios={ios} header="Recent">
            {!yard.recent?.length ? (
              <Row ios={ios} title="Nothing has run yet" last />
            ) : (
              yard.recent.map((j, i) => (
                <Row
                  key={j.id}
                  ios={ios}
                  title={taskTitle(j)}
                  subtitle={`${new Date(j.createdAt).toLocaleString()}${j.costTokens ? ` · ${j.costTokens} tokens` : ''}${
                    j.lastError ? ` · ${j.lastError}` : ''
                  }`}
                  accessory={
                    <Text style={[type.footnote, { color: tone(j.state), fontWeight: '600', marginLeft: 8 }]}>
                      {j.state}
                    </Text>
                  }
                  last={i === yard.recent.length - 1}
                />
              ))
            )}
          </Section>
        </>
      ) : null}

      <View style={{ height: metrics.margin }} />
    </Screen>
  );
}
