import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, RefreshControl, ScrollView, Text, View } from 'react-native';
import { api } from './lib/api';
import { applyFilter, type Filter, taskFilters, windowNote } from './lib/filters';
import { elapsed, type JobStep, runLine } from './lib/fold';
import { GLYPHS } from './lib/glyphs';
import { taskGlyph, taskTitle } from './lib/mentions';
import JobDetailSheet from './JobDetailSheet';
import { SamActionRow, SamChip, SamHScroll, SamRow, SamSection } from './samKit';
import { samColor, samInk, samSpace, samType } from './lib/samTheme';

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

type PublishedSite = { slug: string; name: string; url: string; publishedAt: number; qr: string | null };

export default function TasksScreen({
  onNeedsPairing,
  onOpenPairing,
}: {
  onNeedsPairing: () => void;
  onOpenPairing?: () => void;
}) {
  const [yard, setYard] = useState<Yard | null>(null);
  const [published, setPublished] = useState<PublishedSite[]>([]);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [now, setNow] = useState(() => Date.now());
  // The one thing every row now opens — "failures currently have nowhere to go" (build order
  // step 5). null closes the sheet.
  const [openJobId, setOpenJobId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api('/api/yard');
      setYard(data);
      setError('');
      api('/api/yard/published').then((r: any) => setPublished(r?.sites ?? [])).catch(() => { /* the registry is a nice-to-have; a failed fetch just leaves the section hidden */ });
    } catch (e: any) {
      if (e?.status === 401) {
        setYard(null);
        return;
      }
      setError(e?.message || 'Standalone Mode');
    }
  }, []);

  // Rung 1 — THE PRESS. One tap → a real confirm dialog → the public internet. The confirm
  // is native (Alert), so a slow network or a double-tap can never publish silently — the
  // dialog has to actually be answered before enqueue() is ever called.
  const publishOrUnpublish = useCallback(
    (slug: string, live: PublishedSite | undefined) => {
      if (live) {
        Alert.alert('Unpublish this project?', `${live.url} will stop working.`, [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Unpublish',
            style: 'destructive',
            onPress: () =>
              api('/api/yard/enqueue', { method: 'POST', body: JSON.stringify({ kind: 'project.unpublish', payload: { slug }, confirm: true }) })
                .then(load)
                .catch((e: any) => Alert.alert('Couldn’t unpublish', e?.message || 'Try again from the Mac.')),
          },
        ]);
        return;
      }
      Alert.alert(
        'Publish to the internet?',
        'Anyone with the link will be able to reach it — no login. This is not automatic anywhere else in SAM; you asked for this one, right now.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Publish',
            onPress: () =>
              api('/api/yard/enqueue', { method: 'POST', body: JSON.stringify({ kind: 'project.deploy', payload: { slug }, confirm: true }) })
                .then(load)
                .catch((e: any) => Alert.alert('Couldn’t publish', e?.message || 'This device may need the deploy grant — set it from SAM on the Mac.')),
          },
        ],
      );
    },
    [load],
  );

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
    <ScrollView
      style={{ flex: 1, backgroundColor: samColor.ground }}
      contentContainerStyle={{ paddingTop: samSpace.section, paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={samInk.metadata} />}
    >
      <Text style={[{ fontSize: 33, fontWeight: '700', color: samInk.primary, marginHorizontal: samSpace.gutter, marginBottom: samSpace.section }]}>
        Tasks
      </Text>

      {!yard || error ? (
        <SamSection
          header="Desktop Yard"
          footer="Tasks, background builds, automated playbooks, and file sync run on your desktop hardware. Connect to your Mac or PC to monitor them live from your phone."
        >
          <SamRow glyph={GLYPHS.device} title="Desktop Node" status={<Text style={[samType.mono, { color: samInk.metadata }]}>Not connected</Text>} />
          <SamActionRow title="Connect to Mac / PC" onPress={() => onOpenPairing?.()} />
        </SamSection>
      ) : null}

      {yard && !yard.on ? (
        <SamSection footer="Turn the yard on from SAM on your Mac and jobs will appear here.">
          <SamRow title="The yard is off" />
        </SamSection>
      ) : null}

      {yard?.on ? (
        <>
          {rows.length || filter !== 'all' ? (
            <View style={{ marginBottom: samSpace.section }}>
              <SamHScroll>
                {chips.map((c) => (
                  <SamChip key={c.key} label={c.count != null ? `${c.label} (${c.count})` : c.label} on={c.key === filter} onPress={() => setFilter(c.key)} />
                ))}
              </SamHScroll>
            </View>
          ) : null}

          <SamSection footer={windowNote(yard.recent ?? [], yard) || undefined}>
            {!yard.recent?.length ? (
              <SamRow title="Nothing has run yet" />
            ) : !rows.length ? (
              <SamRow title={`No ${filter} tasks in the last ${yard.recent.length}`} />
            ) : (
              rows.map((j) => (
                <SamRow
                  key={j.id}
                  title={taskTitle(j)}
                  glyph={taskGlyph(j.kind)}
                  meta={subtitleFor(j, now)}
                  status={<StateAccessory state={j.state} />}
                  onPress={() => setOpenJobId(j.id)}
                />
              ))
            )}
          </SamSection>

          {published.length ? (
            <SamSection header="Published" footer="Every project of yours currently live on the internet. Tap a task above to publish or unpublish it.">
              {published.map((s) => (
                <SamRow
                  key={s.slug}
                  title={s.name}
                  meta={s.url}
                  status={s.qr ? <Image source={{ uri: s.qr }} style={{ width: 36, height: 36, borderRadius: 6, backgroundColor: '#fff' }} /> : undefined}
                />
              ))}
            </SamSection>
          ) : null}

          {yard.meter ? (
            <SamSection header="Cost" footer="SAM routes to a free or local brain first — this is what everything actually cost.">
              <SamRow title="Today" status={<Text style={[samType.mono, { color: samInk.metadata }]}>{yard.meter.todayTokens ?? 0} tokens</Text>} />
              <SamRow title="This week" status={<Text style={[samType.mono, { color: samInk.metadata }]}>{yard.meter.weekTokens ?? 0} tokens</Text>} />
            </SamSection>
          ) : null}
        </>
      ) : null}

      <JobDetailSheet
        jobId={openJobId}
        onClose={() => setOpenJobId(null)}
        onNeedsPairing={onNeedsPairing}
        onChanged={load}
        publishedUrl={(() => {
          const j = yard?.recent.find((r) => r.id === openJobId);
          return j?.project ? published.find((s) => s.slug === j.project)?.url : undefined;
        })()}
        onTogglePublish={(slug) => publishOrUnpublish(slug, published.find((s) => s.slug === slug))}
      />
    </ScrollView>
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

// Same meanings as the old stateToneText: done -> green, failed -> red, everything else muted
// (running is carried by the spinner, not colour).
function stateTone(state: Job['state']): string {
  if (state === 'done') return samColor.green;
  if (state === 'failed') return samColor.red;
  return samInk.metadata;
}
function StateAccessory({ state }: { state: Job['state'] }) {
  const running = state === 'running';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ width: 20, alignItems: 'center' }}>
        {running ? <ActivityIndicator size="small" color={samInk.metadata} /> : null}
      </View>
      <Text style={[samType.monoXs, { color: stateTone(state) }]}>{state}</Text>
    </View>
  );
}
