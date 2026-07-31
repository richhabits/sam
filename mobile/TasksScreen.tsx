import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './lib/api';
import { fs, radius, space, type Theme } from './lib/theme';

// THE TASKS SURFACE — every job SAM has run, in your pocket.
//
// Reads the same /api/yard the desk's TasksView reads, so the two never disagree about what
// happened. Read-only on purpose for now: starting work from a phone means running commands
// on the operator's machine, and the yard's own door (isYardTrusted, server/http-guards.ts)
// is deliberately stricter than "this device is paired". Showing state is not that.

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

// Same naming the desk uses (src/TasksView.tsx titleFor) — a job should not be called one
// thing on the Mac and another on the phone.
function titleFor(j: Job): string {
  const p = j.payload || {};
  switch (j.kind) {
    case 'project.build':
      return `Build: ${p.name || j.project || j.id}`;
    case 'project.create':
      return `Create: ${p.name || j.id}`;
    case 'project.edit':
      return `Edit ${p.slug || j.project || 'project'}: ${String(p.what || '').slice(0, 40)}`;
    case 'project.deploy':
      return `Deploy ${p.slug || j.project || j.id}`;
    default:
      return j.project ? `${j.kind} · ${j.project}` : j.kind;
  }
}

export default function TasksScreen({ t, onNeedsPairing }: { t: Theme; onNeedsPairing: () => void }) {
  const s = useMemo(() => makeStyles(t), [t]);
  const [yard, setYard] = useState<Yard | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

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

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const tone = (state: Job['state']) =>
    state === 'done' ? t.ok : state === 'failed' ? t.danger : state === 'running' ? t.accent : t.muted;

  if (!yard && !error) {
    return (
      <View style={s.center}>
        <ActivityIndicator color={t.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={s.list}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
    >
      {error ? <Text style={s.error}>{error}</Text> : null}

      {yard && !yard.on ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>The yard is off</Text>
          <Text style={s.emptySub}>Turn it on from SAM on your Mac and jobs will appear here.</Text>
        </View>
      ) : null}

      {yard?.on ? (
        <>
          <View style={s.counts}>
            {([
              ['Running', yard.running, t.accent],
              ['Queued', yard.queued, t.muted],
              ['Failed', yard.failed, t.danger],
              ['Done', yard.done, t.ok],
            ] as const).map(([label, n, c]) => (
              <View key={label} style={s.count}>
                <Text style={[s.countN, { color: c }]}>{n}</Text>
                <Text style={s.countLabel}>{label}</Text>
              </View>
            ))}
          </View>

          {yard.meter ? (
            <Text style={s.meter}>
              Today {yard.meter.todayTokens ?? 0} · This week {yard.meter.weekTokens ?? 0} tokens
            </Text>
          ) : null}

          {!yard.recent?.length ? (
            <View style={s.empty}>
              <Text style={s.emptyTitle}>Nothing has run yet</Text>
              <Text style={s.emptySub}>Jobs you start on the Mac show up here.</Text>
            </View>
          ) : (
            yard.recent.map((j) => (
              <View key={j.id} style={s.job}>
                <View style={s.jobHead}>
                  <Text style={[s.state, { color: tone(j.state) }]}>{j.state}</Text>
                  <Text style={s.jobTitle} numberOfLines={1}>
                    {titleFor(j)}
                  </Text>
                </View>
                <Text style={s.jobMeta}>
                  {new Date(j.createdAt).toLocaleString()}
                  {j.costTokens ? ` · ${j.costTokens} tokens` : ''}
                </Text>
                {j.lastError ? (
                  <Text style={s.jobError} numberOfLines={2}>
                    {j.lastError}
                  </Text>
                ) : null}
              </View>
            ))
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    list: { padding: space[4], gap: space[3], paddingBottom: space[6] },
    counts: { flexDirection: 'row', gap: space[2] },
    count: {
      flex: 1,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingVertical: space[3],
      alignItems: 'center',
    },
    countN: { fontSize: fs.xl, fontWeight: '800' },
    countLabel: { color: t.muted, fontSize: fs.micro, marginTop: 2 },
    meter: { color: t.muted, fontSize: fs.caption, paddingHorizontal: space[1] },
    job: {
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      padding: space[4],
      gap: space[1],
    },
    jobHead: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    state: { fontSize: fs.micro, fontWeight: '800', textTransform: 'uppercase' },
    jobTitle: { flex: 1, color: t.text, fontSize: fs.md, fontWeight: '700' },
    jobMeta: { color: t.muted, fontSize: fs.caption },
    jobError: { color: t.danger, fontSize: fs.caption },
    empty: { alignItems: 'center', paddingVertical: space[6], gap: space[2] },
    emptyTitle: { color: t.text, fontSize: fs.lg, fontWeight: '700' },
    emptySub: { color: t.muted, fontSize: fs.sm, textAlign: 'center' },
    error: { color: t.danger, fontSize: fs.sm, textAlign: 'center' },
  });
}
