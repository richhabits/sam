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
import { streamChat, type Turn } from './lib/chat';
import { loadThread, saveThread } from './lib/history';
import { parseMarkdown } from './lib/markdown';
import { fs, radius, space, type Theme } from './lib/theme';

// THE AGENT SURFACE — the phone's half of the desk's chat.
//
// Same split the desk has (src/App.tsx: surface === 'agent' | 'tasks'), so the pocket is the
// same product in a smaller frame rather than a different app that happens to share a name.
// Answers stream token-by-token through lib/chat.ts; the route badge under SAM's reply is the
// one thing a generic chat client would never show and the thing SAM is actually about —
// which tier answered, and whether it cost anything.

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
  onNeedsPairing,
  resetKey = 0,
}: {
  t: Theme;
  onNeedsPairing: () => void;
  resetKey?: number;
}) {
  const s = useMemo(() => makeStyles(t), [t]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scroller = useRef<ScrollView>(null);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<TextInput>(null);

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

  const send = useCallback(async () => {
    const message = draft.trim();
    if (!message || busy) return;

    // History is what's on screen BEFORE this turn — the server appends the new message itself.
    const history: Turn[] = msgs
      .filter((m) => !m.pending && m.text)
      .map((m) => ({ role: m.role, text: m.text }));

    setDraft('');
    // Clearing state alone is NOT enough: with an autocorrect suggestion still open, iOS
    // re-applies the pending correction to the native field after React empties it, and the
    // sent message stays sitting in the box looking unsent. clear() ends that session too.
    input.current?.clear();
    setError('');
    setBusy(true);
    setMsgs((prev) => [...prev, { role: 'user', text: message }, { role: 'sam', text: '', pending: true }]);

    const ctrl = new AbortController();
    abort.current = ctrl;

    // Only ever rewrite the LAST message — the pending SAM bubble. Indexing by a captured
    // position would corrupt the wrong turn if anything else touched the list mid-stream.
    const patch = (fn: (m: Msg) => Msg) =>
      setMsgs((prev) => prev.map((m, i) => (i === prev.length - 1 ? fn(m) : m)));

    try {
      await streamChat(
        message,
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
  }, [draft, busy, msgs, onNeedsPairing]);

  const stop = useCallback(() => abort.current?.abort(), []);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
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
                    <ActivityIndicator color={t.accent} />
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

      <View style={s.composer}>
        <TextInput
          ref={input}
          style={s.input}
          value={draft}
          onChangeText={setDraft}
          placeholder="Message SAM"
          placeholderTextColor={t.muted}
          multiline
          onSubmitEditing={send}
          returnKeyType="send"
          blurOnSubmit={false}
        />
        <Pressable
          onPress={busy ? stop : send}
          disabled={!busy && !draft.trim()}
          style={({ pressed }) => [
            s.sendBtn,
            {
              backgroundColor: busy ? t.surface : draft.trim() ? t.accent : t.borderStrong,
              borderWidth: busy ? 1 : 0,
              borderColor: t.borderStrong,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            },
          ]}
        >
          <Text style={{ color: busy ? t.text : t.onAccent, fontSize: fs.base, fontWeight: '700' }}>
            {busy ? '■' : '↑'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    list: { padding: space[4], paddingBottom: space[5], gap: space[3] },
    bubbleUser: {
      alignSelf: 'flex-end',
      maxWidth: '85%',
      backgroundColor: t.accent,
      borderRadius: radius.lg,
      borderBottomRightRadius: radius.sm,
      paddingHorizontal: space[4],
      paddingVertical: space[3],
    },
    userText: { color: t.onAccent, fontSize: fs.body, lineHeight: 22 },
    samWrap: { alignSelf: 'flex-start', maxWidth: '92%', gap: space[1] },
    bubbleSam: {
      alignSelf: 'flex-start',
      maxWidth: '100%',
      backgroundColor: t.surface,
      borderRadius: radius.lg,
      borderBottomLeftRadius: radius.sm,
      borderWidth: 1,
      borderColor: t.border,
      paddingHorizontal: space[4],
      paddingVertical: space[3],
    },
    samText: { color: t.text, fontSize: fs.body, lineHeight: 22 },
    inlineCode: { fontFamily: 'Menlo', fontSize: fs.sm, color: t.accentText },
    codeblock: {
      backgroundColor: t.bg,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.sm,
      padding: space[3],
      marginTop: space[2],
    },
    codeblockText: { fontFamily: 'Menlo', fontSize: fs.caption, color: t.text, lineHeight: 18 },
    route: { color: t.muted, fontSize: fs.micro, paddingLeft: space[2] },
    error: { color: t.danger, fontSize: fs.sm, textAlign: 'center', paddingTop: space[2] },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: space[2],
      paddingHorizontal: space[4],
      paddingTop: space[2],
      paddingBottom: space[3],
      borderTopWidth: 1,
      borderTopColor: t.border,
      backgroundColor: t.bg,
    },
    input: {
      flex: 1,
      maxHeight: 120,
      minHeight: 44,
      color: t.text,
      fontSize: fs.body,
      backgroundColor: t.surface,
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.xl,
      paddingHorizontal: space[4],
      paddingTop: 12,
      paddingBottom: 12,
    },
    sendBtn: { width: 44, height: 44, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  });
}
