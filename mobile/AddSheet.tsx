import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { api } from './lib/api';
import { type Attachment, pickFile, pickPhoto, takePhoto } from './lib/attach';
import { type IOS, metrics, type } from './lib/ios';
import { Row, Section } from './ui';

// "ADD TO SAM" — the + in the composer.
//
// Every row here is backed by an endpoint that was probed with this phone's own bearer and
// answered 200. Nothing is listed that the pocket cannot actually do: a menu full of buttons
// that open "coming soon" is worse than a shorter menu, and it is exactly what makes an app
// feel like a mock-up. Whenever a capability lands server-side, it earns a row here — not before.
//
// The connected services are no longer hand-written. They are whatever /api/connectors reports
// — GitHub, Slack, Notion, Linear, Vercel today — so a connector added on the Mac appears on a
// phone built before it existed, and a service with no token shows no browsable rows at all
// rather than rows that always fail. Same rule as above, enforced by the server rather than by
// someone remembering to edit this array.
//
// What is deliberately ABSENT, and why:
//   • Camera / Photos / Files are here now (expo-image-picker / expo-document-picker). They
//     attach to the message rather than sending immediately, and they route through
//     /api/command, the only endpoint that reads `attachments` and runs vision.
//   • Starting a yard job — POST /api/yard/enqueue is isYardTrusted, which on loopback demands
//     the desktop passkey a phone cannot hold. It works from a real device over the LAN, and
//     returns 403 from the simulator. Read-only until that difference is deliberate, not a
//     surprise.
//   • Approvals (/api/asks) — now reachable, but only for a device the operator gave the
//     "approve" grant to (69d15bd). Off by default, so it is not listed here as if it were
//     always available.
//   • Pasting a connector's token. Every credential write is loopback-gated on purpose, so a
//     phone would only ever get a 403 — the sheet says where it CAN be done instead.

type Native = 'skills' | 'playbooks' | 'schedules' | 'projects' | 'tools';

type Item = { id: string; title: string; sub?: string; url?: string };

/** Where the list on screen came from, and what tapping one of its rows should do next. */
type Level =
  | { source: 'native'; kind: Native; label: string }
  | { source: 'connector'; id: string; kind: string; label: string; param?: string; drill?: string };

type ConnectorList = { kind: string; label: string; hint: string; param?: string; drill?: string };
type Connector = { id: string; label: string; connected: boolean; needsToken: boolean; detail?: string; error?: string; note: string; lists: ConnectorList[] };

const CATALOGUE: { kind: Native; label: string; hint: string }[] = [
  { kind: 'skills', label: 'Skills', hint: 'What SAM is good at' },
  { kind: 'playbooks', label: 'Playbooks', hint: 'Saved runs you can fire' },
  { kind: 'schedules', label: 'Scheduled', hint: 'Things SAM does on a timer' },
  { kind: 'projects', label: 'Projects', hint: 'What SAM is building' },
  { kind: 'tools', label: 'Tools', hint: 'Every tool SAM can reach' },
];

/** SAM's own endpoints each name their own array; normalise to one row so the list stays dumb. */
function toRows(kind: Native, body: any): Item[] {
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

/** One fetch for either kind of level — the connector half already answers in row shape. */
async function fetchLevel(level: Level): Promise<Item[]> {
  if (level.source === 'native') return toRows(level.kind, await api(`/api/${level.kind}`));
  const q = level.param ? `?param=${encodeURIComponent(level.param)}` : '';
  const body: any = await api(`/api/connectors/${level.id}/${level.kind}${q}`);
  return Array.isArray(body?.rows) ? body.rows.slice(0, 60) : [];
}

export default function AddSheet({
  ios,
  visible,
  onClose,
  onPick,
  onAttach,
}: {
  ios: IOS;
  visible: boolean;
  onClose: () => void;
  onPick: (text: string) => void;
  onAttach: (a: Attachment) => void;
}) {
  const [stack, setStack] = useState<Level[]>([]);
  const [rows, setRows] = useState<Item[] | null>(null);
  const [error, setError] = useState('');
  const [conns, setConns] = useState<Connector[] | null>(null);
  const here = stack[stack.length - 1];

  // Reset every time the sheet closes, so reopening never shows the previous list for a
  // heartbeat before the new one loads.
  useEffect(() => {
    if (!visible) {
      setStack([]);
      setRows(null);
      setError('');
    }
  }, [visible]);

  // Which services are live is asked once per opening, not per render — and the server memoises
  // the answer for 30s, so an eager phone cannot turn the + button into five round trips a tap.
  useEffect(() => {
    if (!visible) return;
    let live = true;
    api('/api/connectors')
      .then((b: any) => { if (live) setConns(Array.isArray(b?.connectors) ? b.connectors : []); })
      .catch(() => { if (live) setConns([]); });
    return () => { live = false; };
  }, [visible]);

  const load = useCallback(async (level: Level) => {
    setStack((s) => [...s, level]);
    setRows(null);
    setError('');
    try {
      setRows(await fetchLevel(level));
    } catch (e: any) {
      // The server's own sentence: "that Slack token was rejected" sends you somewhere,
      // "could not load" sends you nowhere.
      setError(e?.message || 'could not load');
      setRows([]);
    }
  }, []);

  // Going back means the rows in state belong to the level we just left, so it re-fetches.
  const back = useCallback(async () => {
    const rest = stack.slice(0, -1);
    setStack(rest);
    setError('');
    const prev = rest[rest.length - 1];
    if (!prev) { setRows(null); return; }
    setRows(null);
    try {
      setRows(await fetchLevel(prev));
    } catch (e: any) {
      setError(e?.message || 'could not load');
      setRows([]);
    }
  }, [stack]);

  const connected = (conns || []).filter((c) => c.connected);
  const offline = (conns || []).filter((c) => !c.connected);
  const connectedRows = connected.flatMap((c) => c.lists.map((l) => ({ c, l })));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: ios.scrim }} onPress={onClose} />
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
          // A top edge of its own. In dark this sheet is groupedBg — pure black — over a dimmed
          // black screen, so without a hairline it has no boundary at all and reads as the page
          // rather than as something laid over it.
          borderTopWidth: metrics.hairline,
          borderTopColor: ios.separator,
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
          <Pressable onPress={here ? back : onClose} hitSlop={10} style={{ minWidth: 70 }}>
            <Text style={[type.body, { color: ios.tint }]}>{here ? '‹ Back' : 'Cancel'}</Text>
          </Pressable>
          <Text style={[type.headline, { color: ios.label, flex: 1, textAlign: 'center' }]} numberOfLines={1}>
            {here ? here.label : 'Add to SAM'}
          </Text>
          <View style={{ minWidth: 70 }} />
        </View>

        <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
          {!here ? (
            <>
            <Section ios={ios} header="Attach" footer="Photos and files ride along with your next message. SAM looks at images on your machine.">
              <Row
                ios={ios}
                title="Camera"
                onPress={async () => {
                  const a = await takePhoto();
                  if (a) { onAttach(a); onClose(); }
                }}
              />
              <Row
                ios={ios}
                title="Photos"
                onPress={async () => {
                  const a = await pickPhoto();
                  if (a) { onAttach(a); onClose(); }
                }}
              />
              <Row
                ios={ios}
                title="Files"
                last
                onPress={async () => {
                  const a = await pickFile();
                  if (a) { onAttach(a); onClose(); }
                }}
              />
            </Section>

            <Section ios={ios} header="From SAM" footer="Picking one drops its name into the message box. Nothing runs until you send it.">
              {CATALOGUE.map((c, i) => (
                <Row
                  key={c.kind}
                  ios={ios}
                  title={c.label}
                  subtitle={c.hint}
                  chevron
                  onPress={() => load({ source: 'native', kind: c.kind, label: c.label })}
                  last={i === CATALOGUE.length - 1}
                />
              ))}
            </Section>

            {connectedRows.length > 0 && (
              <Section
                ios={ios}
                header="Connected"
                footer={`${connected.map((c) => c.label).join(', ')} — read-only. Nothing here can post, merge or change anything.`}
              >
                {connectedRows.map(({ c, l }, i) => (
                  <Row
                    key={`${c.id}/${l.kind}`}
                    ios={ios}
                    title={l.label}
                    subtitle={l.hint}
                    chevron
                    onPress={() => load({ source: 'connector', id: c.id, kind: l.kind, label: l.label, drill: l.drill })}
                    last={i === connectedRows.length - 1}
                  />
                ))}
              </Section>
            )}

            {offline.length > 0 && (
              // Named rather than hidden: knowing Slack COULD be here is the point. The token can
              // only be pasted on the Mac, so the phone says so instead of offering a dead row.
              <Section ios={ios} header="Not connected" footer="Add these on the Mac — Settings → 3rd-Party Integrations. Keys are never accepted from a phone.">
                {offline.map((c, i) => (
                  <Row key={c.id} ios={ios} title={c.label} subtitle={c.error || c.note} last={i === offline.length - 1} />
                ))}
              </Section>
            )}
            </>
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
              {rows.map((r, i) => {
                // A row that drills opens the next list (a repo's issues, a channel's messages);
                // a leaf row drops its name in the composer.
                const drill = here.source === 'connector' ? here.drill : undefined;
                return (
                  <Row
                    key={r.id}
                    ios={ios}
                    title={r.title}
                    subtitle={r.sub}
                    chevron={!!drill}
                    onPress={() => {
                      if (drill && here.source === 'connector') {
                        load({ source: 'connector', id: here.id, kind: drill, label: r.title, param: r.id });
                        return;
                      }
                      onPick(r.title);
                      onClose();
                    }}
                    last={i === rows.length - 1}
                  />
                );
              })}
            </Section>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
