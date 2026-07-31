import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from './lib/api';
import { fs, radius, space, type Theme } from './lib/theme';

// "ADD TO SAM" — the + in the composer.
//
// Every row here is backed by an endpoint that was probed with this phone's own bearer and
// answered 200. Nothing is listed that the pocket cannot actually do: a menu full of buttons
// that open "coming soon" is worse than a shorter menu, and it is exactly what makes an app
// feel like a mock-up. Whenever a capability lands server-side, it earns a row here — not before.
//
// What is deliberately ABSENT, and why:
//   • Camera / Photos / Files — need expo-camera / image-picker / document-picker, i.e. native
//     modules and a rebuild. Worth doing as one batch, not one rebuild per button.
//   • Starting a yard job — POST /api/yard/enqueue is isYardTrusted, which on loopback demands
//     the desktop passkey a phone cannot hold. It works from a real device over the LAN, and
//     returns 403 from the simulator. Read-only until that difference is deliberate, not a
//     surprise.
//   • Approvals (/api/asks) — isTrustedLocal, loopback only. Opening those to paired devices is
//     a security decision for the operator, not a UI change.

type Kind = 'skills' | 'playbooks' | 'schedules' | 'projects' | 'tools';

type Row = { id: string; title: string; sub?: string };

const CATALOGUE: { kind: Kind; label: string; hint: string; glyph: string }[] = [
  { kind: 'skills', label: 'Skills', hint: 'What SAM is good at', glyph: '◆' },
  { kind: 'playbooks', label: 'Playbooks', hint: 'Saved runs you can fire', glyph: '▸' },
  { kind: 'schedules', label: 'Scheduled', hint: 'Things SAM does on a timer', glyph: '◷' },
  { kind: 'projects', label: 'Projects', hint: 'What SAM is building', glyph: '▣' },
  { kind: 'tools', label: 'Tools', hint: 'Every tool SAM can reach', glyph: '⚙' },
];

/** Each endpoint returns a different shape; normalise to one row so the list stays dumb. */
function toRows(kind: Kind, body: any): Row[] {
  const arr = Array.isArray(body) ? body : body?.[kind] || body?.items || [];
  if (!Array.isArray(arr)) return [];
  return arr.slice(0, 60).map((x: any, i: number) => ({
    id: String(x?.id ?? x?.name ?? i),
    title: String(x?.name ?? x?.title ?? x?.id ?? 'untitled'),
    sub:
      kind === 'skills'
        ? [x?.tier, (x?.triggers || []).slice(0, 3).join(', ')].filter(Boolean).join(' · ')
        : kind === 'tools'
          ? x?.description || x?.summary
          : kind === 'schedules'
            ? [x?.cron, x?.enabled === false ? 'paused' : null].filter(Boolean).join(' · ')
            : x?.slug || x?.description,
  }));
}

export default function AddSheet({
  t,
  visible,
  onClose,
  onPick,
}: {
  t: Theme;
  visible: boolean;
  onClose: () => void;
  onPick: (text: string) => void;
}) {
  const s = useMemo(() => makeStyles(t), [t]);
  const [open, setOpen] = useState<Kind | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState('');

  // Reset every time the sheet closes, so reopening never shows the previous list for a
  // heartbeat before the new one loads.
  useEffect(() => {
    if (!visible) {
      setOpen(null);
      setRows(null);
      setError('');
    }
  }, [visible]);

  const load = useCallback(async (kind: Kind) => {
    setOpen(kind);
    setRows(null);
    setError('');
    try {
      setRows(toRows(kind, await api(`/api/${kind}`)));
    } catch (e: any) {
      setError(e?.message || 'could not load');
      setRows([]);
    }
  }, []);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.grabber} />
        <View style={s.head}>
          <Pressable onPress={open ? () => setOpen(null) : onClose} hitSlop={10} style={s.headBtn}>
            <Text style={s.headBtnText}>{open ? '‹' : '✕'}</Text>
          </Pressable>
          <Text style={s.title}>
            {open ? CATALOGUE.find((c) => c.kind === open)?.label : 'Add to SAM'}
          </Text>
          <View style={s.headBtn} />
        </View>

        <ScrollView contentContainerStyle={s.body}>
          {!open ? (
            CATALOGUE.map((c) => (
              <Pressable
                key={c.kind}
                onPress={() => load(c.kind)}
                style={({ pressed }) => [s.row, pressed && { backgroundColor: t.accentSoft }]}
              >
                <Text style={s.glyph}>{c.glyph}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{c.label}</Text>
                  <Text style={s.rowSub}>{c.hint}</Text>
                </View>
                <Text style={s.chev}>›</Text>
              </Pressable>
            ))
          ) : rows === null ? (
            <ActivityIndicator color={t.accent} style={{ marginVertical: space[5] }} />
          ) : error ? (
            <Text style={s.error}>{error}</Text>
          ) : rows.length === 0 ? (
            <Text style={s.empty}>Nothing here yet.</Text>
          ) : (
            rows.map((r) => (
              <Pressable
                key={r.id}
                // Picking drops the name into the composer rather than firing anything. The
                // phone should never silently start work on the operator's machine — you say
                // what you want and send it, same as every other message.
                onPress={() => {
                  onPick(r.title);
                  onClose();
                }}
                style={({ pressed }) => [s.row, pressed && { backgroundColor: t.accentSoft }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{r.title}</Text>
                  {r.sub ? (
                    <Text style={s.rowSub} numberOfLines={1}>
                      {r.sub}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.35)' },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      maxHeight: '78%',
      backgroundColor: t.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingBottom: space[6],
    },
    grabber: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.borderStrong,
      marginTop: space[2],
    },
    head: { flexDirection: 'row', alignItems: 'center', padding: space[3] },
    headBtn: { width: 40, alignItems: 'center' },
    headBtnText: { color: t.text, fontSize: fs.xl, fontWeight: '600' },
    title: { flex: 1, textAlign: 'center', color: t.text, fontSize: fs.lg, fontWeight: '700' },
    body: { paddingHorizontal: space[3] },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[3],
      paddingVertical: 14,
      paddingHorizontal: space[3],
      borderRadius: radius.md,
    },
    glyph: { color: t.accentText, fontSize: fs.lg, width: 24, textAlign: 'center' },
    rowTitle: { color: t.text, fontSize: fs.body, fontWeight: '600' },
    rowSub: { color: t.muted, fontSize: fs.caption, marginTop: 2 },
    chev: { color: t.muted, fontSize: fs.lg },
    empty: { color: t.muted, fontSize: fs.sm, textAlign: 'center', paddingVertical: space[5] },
    error: { color: t.danger, fontSize: fs.sm, textAlign: 'center', paddingVertical: space[5] },
  });
}
