import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { api } from './lib/api';
import { metrics, type, type IOS } from './lib/ios';
import { Row, Section } from './ui';

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
//   • Approvals (/api/asks) — now reachable, but only for a device the operator gave the
//     "approve" grant to (69d15bd). Off by default, so it is not listed here as if it were
//     always available.

type Kind = 'skills' | 'playbooks' | 'schedules' | 'projects' | 'tools';

type Item = { id: string; title: string; sub?: string };

const CATALOGUE: { kind: Kind; label: string; hint: string }[] = [
  { kind: 'skills', label: 'Skills', hint: 'What SAM is good at' },
  { kind: 'playbooks', label: 'Playbooks', hint: 'Saved runs you can fire' },
  { kind: 'schedules', label: 'Scheduled', hint: 'Things SAM does on a timer' },
  { kind: 'projects', label: 'Projects', hint: 'What SAM is building' },
  { kind: 'tools', label: 'Tools', hint: 'Every tool SAM can reach' },
];

/** Each endpoint returns a different shape; normalise to one row so the list stays dumb. */
function toRows(kind: Kind, body: any): Item[] {
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
  ios,
  visible,
  onClose,
  onPick,
}: {
  ios: IOS;
  visible: boolean;
  onClose: () => void;
  onPick: (text: string) => void;
}) {
  const [open, setOpen] = useState<Kind | null>(null);
  const [rows, setRows] = useState<Item[] | null>(null);
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
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} onPress={onClose} />
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          maxHeight: '80%',
          backgroundColor: ios.groupedBg,
          borderTopLeftRadius: 12,
          borderTopRightRadius: 12,
          paddingBottom: 34,
        }}
      >
        {/* iOS sheet grabber, then a nav bar: leading action, centred title, hairline. */}
        <View style={{ alignSelf: 'center', width: 36, height: 5, borderRadius: 3, backgroundColor: ios.separator, marginTop: 6 }} />
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            height: 44,
            paddingHorizontal: metrics.margin,
            borderBottomWidth: metrics.hairline,
            borderBottomColor: ios.separator,
          }}
        >
          <Pressable onPress={open ? () => setOpen(null) : onClose} hitSlop={10} style={{ minWidth: 70 }}>
            <Text style={[type.body, { color: ios.tint }]}>{open ? '‹ Back' : 'Cancel'}</Text>
          </Pressable>
          <Text style={[type.headline, { color: ios.label, flex: 1, textAlign: 'center' }]}>
            {open ? CATALOGUE.find((c) => c.kind === open)?.label : 'Add to SAM'}
          </Text>
          <View style={{ minWidth: 70 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {!open ? (
            <Section ios={ios} footer="Picking one drops its name into the message box. Nothing runs until you send it.">
              {CATALOGUE.map((c, i) => (
                <Row
                  key={c.kind}
                  ios={ios}
                  title={c.label}
                  subtitle={c.hint}
                  chevron
                  onPress={() => load(c.kind)}
                  last={i === CATALOGUE.length - 1}
                />
              ))}
            </Section>
          ) : rows === null ? (
            <ActivityIndicator color={ios.tint} style={{ marginVertical: 32 }} />
          ) : error ? (
            <Section ios={ios}>
              <Row ios={ios} title={error} destructive last />
            </Section>
          ) : rows.length === 0 ? (
            <Section ios={ios}>
              <Row ios={ios} title="Nothing here yet" last />
            </Section>
          ) : (
            <Section ios={ios}>
              {rows.map((r, i) => (
                <Row
                  key={r.id}
                  ios={ios}
                  title={r.title}
                  subtitle={r.sub}
                  onPress={() => {
                    onPick(r.title);
                    onClose();
                  }}
                  last={i === rows.length - 1}
                />
              ))}
            </Section>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
