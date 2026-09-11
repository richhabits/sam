import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { cancelJob, fetchJobDetail, raiseJobBudget, retryJob } from './lib/api';
import type { JobStep } from './lib/fold';
import { haptic } from './lib/haptics';
import { taskGlyph, taskTitle } from './lib/mentions';
import { RunLog, SamSheet, type RunStep } from './samKit';
import { samColor, samInk, samRadius, samSpace, samType } from './lib/samTheme';

// JOB DETAIL SHEET — design_handoff_sam_clients/README.md, build order step 5: "small, high
// value — failures currently have nowhere to go." Before this, TasksScreen's rows had no tap
// target at all unless the job happened to carry a `project` (for publish/unpublish) — a failed
// job's reason, its real log, and any way to act on it were all unreachable on the phone. The
// web app has had this (src/TasksView.tsx's TaskDetail) the whole time; this is its mobile twin.

export type DetailJob = {
  id: string;
  kind: string;
  payload?: { name?: string; slug?: string; what?: string };
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled' | 'stopped';
  createdAt: number;
  finishedAt?: number | null;
  steps?: JobStep[];
  costTokens?: number;
  costBudget?: number;
  lastError?: string | null;
  failureKind?: 'budget' | 'permanent' | 'transient' | null;
  project?: string | null;
};

const stepKind = (s: JobStep): RunStep['kind'] => (s.state === 'failed' ? 'fail' : 'normal');

export default function JobDetailSheet({
  jobId,
  onClose,
  onNeedsPairing,
  onChanged,
  publishedUrl,
  onTogglePublish,
}: {
  /** null closes the sheet — same on/off contract SamSheet's `visible` expects. */
  jobId: string | null;
  onClose: () => void;
  onNeedsPairing: () => void;
  /** Fires after a retry/raise-budget/stop actually changes something server-side, so the
   *  caller (TasksScreen) can refresh its list without this sheet owning that list itself. */
  onChanged: () => void;
  /** The job's project's live URL, if TasksScreen's published-sites list has one — same match
   *  the row's old publish/unpublish affordance used, moved in here (web's TaskDetail keeps
   *  publish inside the detail view too, not on the list row). */
  publishedUrl?: string;
  onTogglePublish?: (slug: string) => void;
}) {
  const [job, setJob] = useState<DetailJob | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [budgetInput, setBudgetInput] = useState('');

  const load = useCallback(async (id: string) => {
    setError('');
    try {
      const r = await fetchJobDetail(id);
      if (!r?.job) {
        setError("That job isn't there any more.");
        return;
      }
      setJob(r.job);
      setLog(Array.isArray(r.log) ? r.log : []);
      setBudgetInput(String(Math.max((r.job.costTokens || 0) * 2, (r.job.costBudget || 0) * 2, 1000)));
    } catch (e: any) {
      if (e?.status === 401) return onNeedsPairing();
      setError(e?.message || "Couldn't reach SAM.");
    }
  }, [onNeedsPairing]);

  useEffect(() => {
    if (jobId) void load(jobId);
    else {
      setJob(null);
      setLog([]);
      setError('');
    }
  }, [jobId, load]);

  const act = useCallback(
    async (fn: () => Promise<any>, failMsg: string) => {
      if (!jobId) return;
      setBusy(true);
      haptic.medium();
      try {
        await fn();
        haptic.success();
        onChanged();
        await load(jobId);
      } catch (e: any) {
        if (e?.status === 401) return onNeedsPairing();
        Alert.alert(failMsg, e?.message || 'Try again from the Mac.');
      } finally {
        setBusy(false);
      }
    },
    [jobId, load, onChanged, onNeedsPairing],
  );

  const isBudgetStop = job?.state === 'failed' && job.failureKind === 'budget';

  return (
    <SamSheet visible={!!jobId} onClose={onClose}>
      <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingHorizontal: samSpace.gutter, paddingBottom: 20 }}>
        {!job ? (
          error ? (
            <Text style={[samType.body, { color: samInk.support, textAlign: 'center', paddingVertical: 30 }]}>{error}</Text>
          ) : (
            <ActivityIndicator color={samColor.accent} style={{ paddingVertical: 30 }} />
          )
        ) : (
          <>
            <Text style={[samType.mono, { color: samColor.accent }]}>{taskGlyph(job.kind)}</Text>
            <Text style={[samType.h3, { color: samInk.primary, marginTop: 4 }]}>{taskTitle(job)}</Text>
            <Text style={[samType.mono, { color: samInk.metadata, marginTop: 4 }]}>
              {job.state.toUpperCase()} · {job.costTokens ?? 0} tokens · created {new Date(job.createdAt).toLocaleString()}
            </Text>

            {/* Failures say what happened, whose fault it was, and what to do next — the
                handoff's own non-negotiable, quoted verbatim in this repo's README. */}
            {job.lastError ? (
              <View
                style={{
                  marginTop: 12,
                  borderRadius: samRadius.row,
                  borderWidth: 1,
                  borderColor: isBudgetStop ? 'rgba(255,159,10,0.35)' : 'rgba(255,69,58,0.35)',
                  backgroundColor: isBudgetStop ? 'rgba(255,159,10,0.06)' : 'rgba(255,69,58,0.06)',
                  padding: 12,
                }}
              >
                <Text style={[samType.bodySm, { color: isBudgetStop ? samColor.amber : samColor.red }]}>{job.lastError}</Text>
              </View>
            ) : null}

            {isBudgetStop ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14 }}>
                <TextInput
                  value={budgetInput}
                  onChangeText={setBudgetInput}
                  keyboardType="number-pad"
                  style={{
                    flex: 1,
                    minHeight: 44,
                    borderRadius: 10,
                    backgroundColor: samColor.input,
                    color: samInk.primary,
                    paddingHorizontal: 12,
                  }}
                  accessibilityLabel="New budget, in tokens"
                />
                <SheetButton
                  label="Raise budget & resume"
                  disabled={busy || !Number(budgetInput)}
                  onPress={() => act(() => raiseJobBudget(jobId as string, Number(budgetInput)), "Couldn't raise that budget")}
                />
              </View>
            ) : (
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                {job.state === 'queued' || job.state === 'running' ? (
                  <SheetButton label="Stop" tone="dim" disabled={busy} onPress={() => act(() => cancelJob(jobId as string), "Couldn't stop that job")} />
                ) : null}
                {job.state === 'failed' ? (
                  // "a retry that names what it retries" — the handoff's own words for this
                  // button (README, "Yard"). The job's own title IS what it retries.
                  <SheetButton
                    label={`Retry ${taskTitle(job)}`}
                    disabled={busy}
                    onPress={() => act(() => retryJob(jobId as string), "Couldn't retry that job")}
                  />
                ) : null}
              </View>
            )}

            {job.steps?.length ? (
              <View style={{ marginTop: 16 }}>
                <RunLog
                  state={job.state === 'running' ? 'working' : job.state === 'failed' ? 'failed' : 'done'}
                  cost={`£0.00`}
                  steps={job.steps.map((st, i): RunStep => ({ id: String(i), label: st.error ? `${st.label} — ${st.error}` : st.label, kind: stepKind(st) }))}
                />
              </View>
            ) : null}

            <View
              style={{
                marginTop: 16,
                borderRadius: 14,
                backgroundColor: samColor.raise2,
                padding: 12,
                maxHeight: 220,
              }}
            >
              <ScrollView>
                <Text style={{ fontFamily: 'Menlo', fontSize: 11.5, color: samInk.support, lineHeight: 17 }} selectable>
                  {log.length ? log.join('\n') : 'No log output yet.'}
                </Text>
              </ScrollView>
            </View>

            {job.project ? (
              <View style={{ marginTop: 16 }}>
                {publishedUrl ? <Text style={{ color: samInk.support, fontSize: 13, marginBottom: 8 }}>Live at {publishedUrl}</Text> : null}
                <SheetButton
                  label={publishedUrl ? 'Unpublish' : 'Publish to the internet'}
                  tone={publishedUrl ? 'dim' : undefined}
                  disabled={busy}
                  onPress={() => onTogglePublish?.(job.project as string)}
                />
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </SamSheet>
  );
}

function SheetButton({ label, onPress, disabled, tone }: { label: string; onPress: () => void; disabled?: boolean; tone?: 'dim' }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => ({
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 16,
        borderRadius: 999,
        backgroundColor: tone === 'dim' ? 'transparent' : disabled ? samColor.raise : pressed ? samColor.accentDk : samColor.accent,
        borderWidth: tone === 'dim' ? 1 : 0,
        borderColor: 'rgba(253,246,239,0.12)',
        opacity: disabled ? 0.6 : 1,
      })}
    >
      <Text style={{ color: tone === 'dim' ? samInk.primary : samColor.ground, fontWeight: '700', fontSize: 15 }}>{label}</Text>
    </Pressable>
  );
}
