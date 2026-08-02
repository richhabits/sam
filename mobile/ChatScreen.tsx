import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AddSheet from './AddSheet';
import { api } from './lib/api';
import { streamChat, type Turn } from './lib/chat';
import { sendWithAttachments, type Attachment } from './lib/attach';
import { loadThread, saveThread } from './lib/history';
import { parseMarkdown } from './lib/markdown';
import {
  activeReferences,
  applyMention,
  buildReferencedMessage,
  findMention,
  matchTasks,
  mentionLabel,
  removeMention,
  taskContext,
  taskTitle,
  type RecentTask,
  type TaskReference,
} from './lib/mentions';
import { fs, radius, space, type Theme } from './lib/theme';
import { metrics, type as iosType, type IOS } from './lib/ios';

// THE AGENT SURFACE — the phone's half of the desk's chat.
//
// Same split the desk has (src/App.tsx: surface === 'agent' | 'tasks'), so the pocket is the
// same product in a smaller frame rather than a different app that happens to share a name.
// Answers stream token-by-token through lib/chat.ts; the route badge under SAM's reply is the
// one thing a generic chat client would never show and the thing SAM is actually about —
// which tier answered, and whether it cost anything.
//
// Typing `@` opens the same task history the Tasks surface shows (/api/yard), and picking one
// attaches its context to the next message — the phone's version of `@` in an editor. The
// parsing lives in lib/mentions.ts; everything below is fetching and pixels.

type Msg = { role: 'user' | 'sam'; text: string; route?: string; pending?: boolean };

const GREETING =
  "I'm SAM — your own assistant, running on your machine.\n\nAsk me anything, or give me something to do. I'll tell you which brain answered and what it cost.";

/** SAM answers in markdown, so render it as markdown — literal ** and ``` on screen is what a
 *  lazy port looks like. Blocks re-parse on every token, which is cheap and keeps a code fence
 *  from flashing as prose before its closing ``` arrives. */
function Rendered({ text, t, s }: { text: string; t: Theme; s: any }) {
  return (
    <>
      {parseMarkdown(text).map((b, i) =>
        b.kind === 'codeblock' ? (
          <View key={i} style={s.codeblock}>
            <Text style={s.codeblockText}>{b.text}</Text>
          </View>
        ) : (
          <Text key={i} style={s.samText}>
            {b.segments.map((seg, j) =>
              seg.kind === 'bold' ? (
                <Text key={j} style={{ fontWeight: '700' }}>
                  {seg.text}
                </Text>
              ) : seg.kind === 'code' ? (
                <Text key={j} style={s.inlineCode}>
                  {seg.text}
                </Text>
              ) : (
                <Text key={j}>{seg.text}</Text>
              ),
            )}
          </Text>
        ),
      )}
    </>
  );
}

export default function ChatScreen({
  t,
  ios,
  onNeedsPairing,
  resetKey = 0,
}: {
  t: Theme;
  ios: IOS;
  onNeedsPairing: () => void;
  resetKey?: number;
}) {
  const s = useMemo(() => makeStyles(ios), [ios]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scroller = useRef<ScrollView>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<TextInput>(null);
  const [sheet, setSheet] = useState(false);
  const [tier, setTier] = useState<'auto' | 'free' | 'turbo'>('auto');
  // Bumped on every send to remount the composer — see the note in send().
  const [composerKey, setComposerKey] = useState(0);
  // Attachments ride along with the NEXT message and are cleared once it is sent.
  const [attached, setAttached] = useState<Attachment[]>([]);
  // @-references do the same, and are tracked as objects rather than parsed back out of the
  // text: the box holds a human-readable label, the reference holds the context that label
  // stands for, and the two are reconciled at send time by activeReferences().
  const [refs, setRefs] = useState<TaskReference[]>([]);
  const [caret, setCaret] = useState(0);
  const [yard, setYard] = useState<{ on: boolean; recent: RecentTask[] } | null>(null);
  const [yardError, setYardError] = useState('');
  // The @ a dismissal belongs to, by position. Storing the position rather than a bare boolean
  // is what makes "no, not now" apply to THIS mention only — delete it, or start another one
  // further along, and the picker is allowed back.
  const [dismissed, setDismissed] = useState<number | null>(null);
  const loadingYard = useRef(false);

  // Keep the newest turn in view as tokens arrive, not just when a message is added.
  useEffect(() => {
    const id = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [msgs]);

  // A stream left running when the screen goes away keeps a socket and a setState alive.
  useEffect(() => () => abort.current?.abort(), []);

  // Restore the thread on launch. Losing every conversation on app switch is the most
  // "unfinished" thing a chat client can do, and SAM's pitch is a memory that compounds.
  // resetKey changes when "New chat" fires, which re-runs this against a cleared store.
  useEffect(() => {
    loadThread().then((turns) => setMsgs(turns.map((x) => ({ ...x }))));
  }, [resetKey]);

  // Persist only settled turns — a half-streamed answer written to the Keychain would be
  // restored as a truncated reply that looks like SAM gave up mid-sentence.
  useEffect(() => {
    if (busy) return;
    const settled = msgs.filter((m) => !m.pending && m.text);
    if (settled.length) void saveThread(settled.map(({ role, text, route }) => ({ role, text, route })));
  }, [msgs, busy]);

  const mention = useMemo(() => findMention(draft, caret), [draft, caret]);
  const picking = !!mention && dismissed !== mention.start;
  // Only chips for references whose token is still in the box — a backspaced label must not
  // leave a chip behind claiming context that is no longer being sent.
  const liveRefs = useMemo(() => activeReferences(draft, refs), [draft, refs]);

  // The task list is fetched the first time an @ appears, not on mount: most messages contain
  // no @ at all, and a chat screen has no business hitting the yard to open.
  const loadYard = useCallback(async () => {
    if (loadingYard.current) return;
    loadingYard.current = true;
    try {
      const y: any = await api('/api/yard');
      setYard({ on: !!y?.on, recent: Array.isArray(y?.recent) ? y.recent : [] });
      setYardError('');
    } catch (e: any) {
      // Revoked from the Mac is a pairing problem everywhere in this app, never a feature that
      // quietly does nothing.
      if (e?.status === 401) return onNeedsPairing();
      setYardError(e?.message || "Couldn't reach SAM.");
    } finally {
      loadingYard.current = false;
    }
  }, [onNeedsPairing]);

  useEffect(() => {
    // Not retried while an error is on screen — the picker offers the retry instead, so an
    // unreachable Mac costs one request per tap rather than one per keystroke.
    if (picking && !yard && !yardError) void loadYard();
  }, [picking, yard, yardError, loadYard]);

  const pick = useCallback(
    async (task: RecentTask) => {
      if (!mention) return;
      const label = mentionLabel(task);
      const applied = applyMention(draft, mention, label, caret);
      setDraft(applied.text);
      setCaret(applied.cursor);
      setDismissed(null);
      // Resolve the context NOW, with the summary row as the answer if the detail call fails.
      // Doing it at send time instead would mean a reference silently becoming nothing at the
      // exact moment it was needed, and doing it without a fallback would mean losing the pick
      // because the Mac went to sleep between tapping and sending.
      setRefs((prev) => [...prev.filter((r) => r.id !== task.id), { id: task.id, label, context: taskContext(task) }]);
      try {
        const detail: any = await api(`/api/yard/job/${encodeURIComponent(task.id)}`);
        setRefs((prev) => prev.map((r) => (r.id === task.id ? { ...r, context: taskContext(task, detail) } : r)));
      } catch {
        /* the summary above is already a usable reference — keep it */
      }
    },
    [mention, draft, caret],
  );

  const onDraft = useCallback(
    (v: string) => {
      // Move the caret by the size of the edit rather than waiting for onSelectionChange. RN
      // fires the two events separately, so judging the new text against the OLD caret makes
      // the very first "@" of a message miss — and with the caret still at its initial 0, miss
      // permanently. onSelectionChange corrects this the moment it lands; this just means the
      // picker never owes its appearance to event ordering.
      setCaret((c) => Math.max(0, Math.min(v.length, c + (v.length - draft.length))));
      setDraft(v);
      // A dismissal dies with the @ it dismissed. Without this, deleting the @ and typing a new
      // one at the same offset would find the picker still switched off, with nothing on screen
      // to explain why.
      if (!findMention(v, v.length)) setDismissed(null);
    },
    [draft],
  );

  const send = useCallback(async () => {
    const message = draft.trim();
    const attachments = attached;
    // An attachment on its own is a complete thought ("what is this?"), so an empty box with
    // something attached is still sendable.
    if ((!message && !attachments.length) || busy) return;

    // What the model gets and what the bubble shows are deliberately different: the operator
    // sees the sentence they typed, SAM also gets the referenced tasks' context in front of it.
    // Showing them the log they didn't write would make @ feel like a paste, not a reference.
    const outbound = buildReferencedMessage(message, activeReferences(message, refs));

    // History is what's on screen BEFORE this turn — the server appends the new message itself.
    const history: Turn[] = msgs
      .filter((m) => !m.pending && m.text)
      .map((m) => ({ role: m.role, text: m.text }));

    setDraft('');
    setCaret(0);
    setRefs([]);
    setDismissed(null);
    // Emptying `draft` is not enough on its own. With an autocorrect suggestion still open,
    // iOS applies the pending correction to the NATIVE field after React has emptied it —
    // and since React's own value never changed, a controlled TextInput has nothing to
    // re-sync, so the sent text sits in the box looking unsent. clear() does not help (the
    // correction lands after it) and neither does blur()+clear()+refocus. Remounting the
    // field is the one thing iOS cannot write through: a new native field starts genuinely
    // empty. autoFocus keeps the keyboard up so it still reads as one conversation.
    //
    // Only reproduces with a word iOS actually corrects ("colour" -> "color") — which is why
    // it survived two earlier fixes that were tested with words it leaves alone.
    setComposerKey((k) => k + 1);
    setError('');
    setBusy(true);
    setAttached([]);
    setMsgs((prev) => [
      ...prev,
      { role: 'user', text: message || (attachments.length === 1 ? `📎 ${attachments[0].name || 'attachment'}` : `📎 ${attachments.length} attachments`) },
      { role: 'sam', text: '', pending: true },
    ]);

    const ctrl = new AbortController();
    abort.current = ctrl;

    // Only ever rewrite the LAST message — the pending SAM bubble. Indexing by a captured
    // position would corrupt the wrong turn if anything else touched the list mid-stream.
    const patch = (fn: (m: Msg) => Msg) =>
      setMsgs((prev) => prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)));

    try {
      if (attachments.length) {
        // /api/stream ignores `attachments`; /api/command reads them and runs vision. One
        // request, one finished answer — faking a stream over a completed reply is theatre.
        const r = await sendWithAttachments(outbound, attachments, history);
        patch((m) => ({
          ...m,
          text: r.text || '(no answer)',
          pending: false,
          route: [r.tier, r.provider].filter(Boolean).join(' · ') || 'looked at your attachment',
        }));
        return;
      }
      await streamChat(
        outbound,
        history,
        {
          onRoute: (e) => {
            const label = e.cached ? 'from memory · 0 tokens' : e.reason || e.tier || '';
            patch((m) => ({ ...m, route: label }));
          },
          onToken: (text) => patch((m) => ({ ...m, text, pending: false })),
          onDone: (text) => patch((m) => ({ ...m, text, pending: false })),
        },
        ctrl.signal,
        tier === 'auto' ? undefined : tier,
      );
    } catch (e: any) {
      if (ctrl.signal.aborted) {
        patch((m) => ({ ...m, pending: false, text: m.text || 'Stopped.' }));
      } else if (e?.status === 401) {
        // Revoked from the Mac — a pairing problem, never dressed up as a model failure.
        onNeedsPairing();
      } else {
        setError(e?.message || "Couldn't reach SAM.");
        setMsgs((prev) => prev.slice(0, -1)); // drop the empty bubble, keep the question
      }
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }, [draft, busy, msgs, onNeedsPairing, tier, attached, refs]);

  const stop = useCallback(() => abort.current?.abort(), []);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: ios.groupedBg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <ScrollView
        ref={scroller}
        style={{ flex: 1 }}
        contentContainerStyle={s.list}
        keyboardShouldPersistTaps="handled"
      >
        {msgs.length === 0 ? (
          <View style={s.bubbleSam}>
            <Text style={s.samText}>{GREETING}</Text>
          </View>
        ) : (
          msgs.map((m, i) =>
            m.role === 'user' ? (
              <View key={i} style={s.bubbleUser}>
                <Text style={s.userText}>{m.text}</Text>
              </View>
            ) : (
              <View key={i} style={s.samWrap}>
                <View style={s.bubbleSam}>
                  {m.pending && !m.text ? (
                    <ActivityIndicator color={ios.tint} />
                  ) : (
                    <Rendered text={m.text} t={t} s={s} />
                  )}
                </View>
                {m.route ? <Text style={s.route}>{m.route}</Text> : null}
              </View>
            ),
          )
        )}
        {error ? <Text style={s.error}>{error}</Text> : null}
      </ScrollView>

      {attached.length ? (
        <View style={s.tierBar}>
          {attached.map((a, i) => (
            <Pressable
              key={i}
              onPress={() => setAttached((prev) => prev.filter((_, j) => j !== i))}
              style={[s.tierChip, { backgroundColor: ios.fill }]}
            >
              <Text style={[s.tierText, { color: ios.tint }]}>{(a.name || 'attachment').slice(0, 22)}  ✕</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* What is riding along with the next message, and how to take it back off. Same chip as
          an attachment because it is the same idea — something added to the box, not typed. */}
      {liveRefs.length ? (
        <View style={s.tierBar}>
          {liveRefs.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => {
                setRefs((prev) => prev.filter((x) => x.id !== r.id));
                setDraft((d) => removeMention(d, r.label));
              }}
              style={[s.tierChip, { backgroundColor: ios.fill }]}
            >
              <Text style={[s.tierText, { color: ios.tint }]}>@{r.label.slice(0, 22)}  ✕</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={s.tierBar}>
        {(['auto', 'free', 'turbo'] as const).map((k) => (
          <Pressable
            key={k}
            onPress={() => setTier(k)}
            style={[s.tierChip, tier === k && { backgroundColor: ios.fill }]}
          >
            <Text style={[s.tierText, { color: tier === k ? ios.tint : ios.secondaryLabel }]}>
              {k === 'auto' ? 'Auto' : k === 'free' ? 'Free only' : 'Turbo'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* THE @ PICKER — recent tasks, right above the keyboard. Never a modal: the operator is
          mid-sentence, and a sheet that takes the screen would lose the sentence. */}
      {picking ? (
        <View style={s.picker}>
          <View style={s.pickerHead}>
            <Text style={s.pickerTitle}>RECENT TASKS</Text>
            {/* Typing a space closes this on its own, but a control that says so is the
                difference between "it went away" and "I put it away". */}
            <Pressable onPress={() => setDismissed(mention!.start)} hitSlop={10}>
              <Text style={[s.pickerAction, { color: ios.tint }]}>Dismiss</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 176 }}>
            {yardError ? (
              <Pressable onPress={() => setYardError('')} style={s.pickerRow}>
                <Text style={[s.pickerRowTitle, { color: ios.destructive }]} numberOfLines={2}>
                  {yardError}
                </Text>
                <Text style={s.pickerRowSub}>Tap to try again.</Text>
              </Pressable>
            ) : !yard ? (
              <ActivityIndicator color={ios.tint} style={{ marginVertical: 18 }} />
            ) : !yard.on ? (
              <View style={s.pickerRow}>
                <Text style={s.pickerRowSub}>
                  The yard is off. Turn it on from SAM on your Mac and past tasks appear here.
                </Text>
              </View>
            ) : (
              (() => {
                const hits = matchTasks(yard.recent, mention!.query);
                if (!hits.length) {
                  return (
                    <View style={s.pickerRow}>
                      <Text style={s.pickerRowSub}>
                        {yard.recent.length ? 'No task matches that.' : 'Nothing has run yet.'}
                      </Text>
                    </View>
                  );
                }
                return hits.map((t, i) => (
                  <Pressable
                    key={t.id}
                    onPress={() => void pick(t)}
                    style={({ pressed }) => [s.pickerRow, pressed && { backgroundColor: ios.cardPressed }, i === hits.length - 1 && { borderBottomWidth: 0 }]}
                  >
                    <Text style={s.pickerRowTitle} numberOfLines={1}>{taskTitle(t)}</Text>
                    <Text style={s.pickerRowSub} numberOfLines={1}>
                      {[t.state, t.createdAt ? new Date(t.createdAt).toLocaleString() : null].filter(Boolean).join(' · ')}
                    </Text>
                  </Pressable>
                ));
              })()
            )}
          </ScrollView>
        </View>
      ) : null}

      <AddSheet
        ios={ios}
        visible={sheet}
        onClose={() => setSheet(false)}
        onPick={(x) => setDraft((d) => (d ? d + ' ' + x : x))}
        onAttach={(a) => setAttached((prev) => [...prev, a])}
      />

      <View style={s.composer}>
        <Pressable
          onPress={() => setSheet(true)}
          style={({ pressed }) => [s.plus, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}
          hitSlop={6}
        >
          <Text style={s.plusText}>+</Text>
        </Pressable>
        <TextInput
          key={composerKey}
          autoFocus={composerKey > 0}
          // Autocorrect OFF is the actual fix, not a preference. Three attempts to clean up
          // after it failed (see send()), because iOS writes the correction into the native
          // field out of band and a controlled input has nothing to re-sync against. With no
          // correction pending there is nothing to write back. The cost is real — no
          // autocorrect while typing to SAM — and it is the right trade for a composer where
          // the text is often a command, a path or a flag that iOS would "fix" anyway.
          autoCorrect={false}
          spellCheck={false}
          ref={input}
          style={s.input}
          value={draft}
          onChangeText={onDraft}
          // The caret, not the end of the string, is what decides whether an @ is live —
          // otherwise going back to add a reference mid-sentence does nothing at all.
          onSelectionChange={(e) => setCaret(e.nativeEvent.selection.end)}
          placeholder="Message SAM"
          placeholderTextColor={ios.secondaryLabel}
          multiline
          onSubmitEditing={send}
          returnKeyType="send"
          blurOnSubmit={false}
        />
        <Pressable
          onPress={busy ? stop : send}
          disabled={!busy && !draft.trim() && !attached.length}
          style={({ pressed }) => [
            s.sendBtn,
            {
              backgroundColor: busy ? ios.fill : draft.trim() || attached.length ? ios.tint : ios.fill,
              
              transform: [{ scale: pressed ? 0.94 : 1 }],
            },
          ]}
        >
          <Text style={{ color: busy ? ios.label : draft.trim() || attached.length ? ios.onTint : ios.secondaryLabel, fontSize: 15, fontWeight: '700' }}>
            {busy ? '■' : '↑'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(ios: IOS) {
  return StyleSheet.create({
    list: { padding: metrics.margin, paddingBottom: 24, gap: 8 },
    // iMessage geometry: 18pt radius, a squared corner on the sender's side, 17pt body.
    bubbleUser: {
      alignSelf: 'flex-end',
      maxWidth: '78%',
      backgroundColor: ios.tint,
      borderRadius: 18,
      borderBottomRightRadius: 4,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    userText: { ...iosType.body, color: ios.onTint, lineHeight: 22 },
    samWrap: { alignSelf: 'flex-start', maxWidth: '86%', gap: 3 },
    bubbleSam: {
      alignSelf: 'flex-start',
      maxWidth: '100%',
      backgroundColor: ios.card,
      borderRadius: 18,
      borderBottomLeftRadius: 4,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    samText: { ...iosType.body, color: ios.label, lineHeight: 22 },
    inlineCode: { fontFamily: 'Menlo', fontSize: 15, color: ios.tint },
    codeblock: {
      backgroundColor: ios.groupedBg,
      borderRadius: 8,
      padding: 10,
      marginTop: 6,
    },
    codeblockText: { fontFamily: 'Menlo', fontSize: 13, color: ios.label, lineHeight: 18 },
    route: { ...iosType.caption, color: ios.secondaryLabel, paddingLeft: 6 },
    error: { ...iosType.footnote, color: ios.destructive, textAlign: 'center', paddingTop: 8 },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      paddingHorizontal: metrics.margin,
      paddingTop: 6,
      paddingBottom: 8,
      borderTopWidth: metrics.hairline,
      borderTopColor: ios.separator,
      backgroundColor: ios.card,
    },
    input: {
      flex: 1,
      maxHeight: 120,
      minHeight: 36,
      ...iosType.body,
      color: ios.label,
      backgroundColor: ios.groupedBg,
      borderRadius: 18,
      paddingHorizontal: 14,
      paddingTop: 8,
      paddingBottom: 8,
    },
    plus: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
    plusText: { fontSize: 26, color: ios.tint, lineHeight: 30, fontWeight: '300' },
    tierBar: { flexDirection: 'row', gap: 6, paddingHorizontal: metrics.margin, paddingBottom: 6, flexWrap: 'wrap' },
    // An inset card sitting on the composer, the way an iOS autocomplete bar does — the
    // conversation stays visible above it, which is the point of not making this a sheet.
    picker: {
      marginHorizontal: metrics.margin,
      marginBottom: 6,
      backgroundColor: ios.card,
      borderRadius: metrics.radius,
      borderWidth: metrics.hairline,
      borderColor: ios.separator,
      overflow: 'hidden',
    },
    pickerHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingTop: 8,
      paddingBottom: 4,
    },
    pickerTitle: { ...iosType.caption, color: ios.secondaryLabel, letterSpacing: 0.6 },
    pickerAction: { ...iosType.footnote, fontWeight: '600' },
    pickerRow: {
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderBottomWidth: metrics.hairline,
      borderBottomColor: ios.separator,
    },
    pickerRowTitle: { ...iosType.body, color: ios.label },
    pickerRowSub: { ...iosType.caption, color: ios.secondaryLabel, marginTop: 1 },
    tierChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    tierText: { ...iosType.caption, fontWeight: '600' },
    sendBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  });
}
