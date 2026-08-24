import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
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
import { type Attachment, sendWithAttachments } from './lib/attach';
import { streamChat, type Turn } from './lib/chat';
import { consentCopy, loadConsent, needsConsent, type SpendConsent, setConsent } from './lib/consent';
import { loadThread, saveThread } from './lib/history';
import { type IOS, type as iosType, metrics, stateTone } from './lib/ios';
import { parseMarkdown } from './lib/markdown';
import {
  activeReferences,
  applyMention,
  buildReferencedMessage,
  findMention,
  matchTasks,
  mentionLabel,
  type RecentTask,
  removeMention,
  type TaskReference,
  taskContext,
  taskGlyph,
  taskTitle,
  taskWhen,
} from './lib/mentions';
import { Glyph } from './ui';

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

// The opening screen's starting points. Kept SHORT — these are prompts to edit, not menu items,
// and a chip you cannot read at a glance is a chip nobody taps. Each one names something SAM
// actually does rather than describing an assistant in general: the whole pitch is that this one
// runs on your own machine and can act, so the openers should sound like that and nothing else.
const STARTERS = [
  'What can you do?',
  'Summarise my day',
  'Build me a one-page site',
  'What did you run today?',
  'Find a file on my Mac',
];

// WHICH BRAIN ANSWERS. The words 'free' and 'turbo' are meaningless on their own — they only
// become a choice once someone says what each one costs you. So every option carries its
// consequence in a line, and the sheet shows that line rather than making the name do the work.
// 'auto' is first and is the default because it is the answer for anyone who has no opinion,
// which is almost everyone almost all of the time.
const BRAINS = [
  { key: 'auto' as const, name: 'Auto', why: 'SAM picks. Free when free will do, paid when it will not.' },
  { key: 'free' as const, name: 'Free', why: 'Only models that cost nothing. Slower, and sometimes it declines.' },
  { key: 'turbo' as const, name: 'Turbo', why: 'The best model available. Uses paid credit when it has to.' },
];

import * as Clipboard from 'expo-clipboard';

function CodeBlockView({ text, lang, s, ios }: { text: string; lang?: string; s: any; ios: IOS }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    await Clipboard.setStringAsync(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  const displayLang = (lang || 'code').toUpperCase();

  return (
    <View style={s.codeblock}>
      <View style={s.codeblockHeader}>
        <Text style={s.codeblockLang}>{displayLang}</Text>
        <Pressable
          onPress={handleCopy}
          hitSlop={8}
          style={({ pressed }) => [s.copyBtn, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Copy code"
        >
          <Text style={[s.copyBtnText, copied && { color: ios.tintText }]}>
            {copied ? '✓ Copied' : 'Copy'}
          </Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: '100%' }}>
        <Text style={s.codeblockText} selectable>{text}</Text>
      </ScrollView>
    </View>
  );
}

/** SAM answers in markdown, so render it as markdown — literal ** and ``` on screen is what a
 *  lazy port looks like. Blocks re-parse on every token, which is cheap and keeps a code fence
 *  from flashing as prose before its closing ``` arrives. */
function Rendered({ text, s, ios }: { text: string; s: any; ios: IOS }) {
  return (
    <>
      {parseMarkdown(text).map((b, i) =>
        b.kind === 'codeblock' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: re-derived in full on every render
          <CodeBlockView key={i} text={b.text} lang={b.lang} s={s} ios={ios} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: re-derived in full on every render
          <Text key={i} style={s.samText}>
            {b.segments.map((seg, j) =>
              seg.kind === 'bold' ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: re-derived in full on every render
                <Text key={j} style={{ fontWeight: '700' }}>
                  {seg.text}
                </Text>
              ) : seg.kind === 'code' ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: re-derived in full on every render
                <Text key={j} style={s.inlineCode}>
                  {seg.text}
                </Text>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: re-derived in full on every render
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
  ios,
  onNeedsPairing,
  resetKey = 0,
  prompt = null,
}: {
  ios: IOS;
  onNeedsPairing: () => void;
  resetKey?: number;
  /** Text handed in by a `sam://ask?text=…` link — a widget tap, a Shortcut, a QR code. */
  prompt?: string | null;
}) {
  const s = useMemo(() => makeStyles(ios), [ios]);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const scroller = useRef<ScrollView>(null);

  // A quick-action link PRE-FILLS the composer; it does not send. The parser only accepts our own
  // scheme and bounds the text, but "any app on this phone can open a URL" is still the threat
  // model — one that sends on arrival lets any of them put words in SAM's ear without the operator
  // seeing them. One tap to a prepared prompt keeps the point of a widget and leaves the decision
  // where it belongs. Appended, so it cannot silently eat a draft already in progress.
  useEffect(() => {
    if (!prompt) return;
    setDraft((d) => (d.trim() ? `${d.trim()} ${prompt}` : prompt));
  }, [prompt]);
  const abort = useRef<AbortController | null>(null);
  const input = useRef<TextInput>(null);
  const [sheet, setSheet] = useState(false);
  const [tier, setTier] = useState<'auto' | 'free' | 'turbo'>('auto');
  // Whether SAM may reach for a paid brain without asking. Restored on mount, because a grant
  // the operator already gave should not be asked for again every launch.
  const [consent, setConsentState] = useState<SpendConsent>('ask');
  const [askingConsent, setAskingConsent] = useState(false);
  // A one-shot bypass rather than a state flag: "Allow once" calls send() immediately, and a
  // state update would not have landed by the time the gate re-reads it.
  const allowOnce = useRef(false);
  useEffect(() => {
    loadConsent().then(setConsentState);
  }, []);
  const [brainPicker, setBrainPicker] = useState(false);
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: msgs is a TRIGGER, not an input — the body never reads it, and dropping it stops the scroll following the stream.
  useEffect(() => {
    const id = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(id);
  }, [msgs]);

  // A stream left running when the screen goes away keeps a socket and a setState alive.
  useEffect(() => () => abort.current?.abort(), []);

  // Restore the thread on launch. Losing every conversation on app switch is the most
  // "unfinished" thing a chat client can do, and SAM's pitch is a memory that compounds.
  // resetKey changes when "New chat" fires, which re-runs this against a cleared store.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is a TRIGGER, not an input — the body never reads it, and dropping it means "New chat" never reloads the cleared thread.
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

  // The task list is fetched when something on screen actually wants it: the first `@`, or an
  // empty thread, whose opening screen offers recent work to pick up. Never on every mount —
  // once a conversation exists, neither surface is visible and the yard goes unasked.
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

  // A failed fetch used to be remembered for the life of this screen, and the two surfaces
  // that want the yard have opposite needs. The PICKER fires on every keystroke, so it must
  // not retry while an error stands — that is what `!yardError` is for. The OPENING SCREEN
  // renders once per empty thread, and treating its one failure as permanent meant a phone
  // that failed a fetch before it was paired never showed recent work again, however
  // successfully it paired afterwards. Romeo hit exactly that: paired, real jobs in the yard,
  // and an opening screen that stayed blank because of a refusal from minutes earlier.
  //
  // So the opening screen gets its own single attempt, and the ref is cleared whenever a
  // conversation exists — meaning every NEW chat is a fresh try rather than one per app launch.
  const openingTried = useRef(false);
  useEffect(() => {
    if (msgs.length > 0) openingTried.current = false;
  }, [msgs.length]);

  useEffect(() => {
    if (picking && !yard && !yardError) void loadYard();
    if (msgs.length === 0 && !yard && !openingTried.current) {
      openingTried.current = true;
      setYardError('');   // a stale refusal must not outlive the pairing that fixed it
      void loadYard();
    }
  }, [picking, msgs.length, yard, yardError, loadYard]);

  // Resolve a task's context NOW, with the summary row as the answer if the detail call fails.
  // Doing it at send time instead would mean a reference silently becoming nothing at the exact
  // moment it was needed, and doing it without a fallback would mean losing the pick because the
  // Mac went to sleep between tapping and sending.
  //
  // Shared by both ways in — typing `@` and tapping a card on the opening screen. They differ only
  // in how the token reaches the box; what a reference IS should not depend on which one you used.
  const attachReference = useCallback(async (task: RecentTask, label: string) => {
    setRefs((prev) => [...prev.filter((r) => r.id !== task.id), { id: task.id, label, context: taskContext(task) }]);
    try {
      const detail: any = await api(`/api/yard/job/${encodeURIComponent(task.id)}`);
      setRefs((prev) => prev.map((r) => (r.id === task.id ? { ...r, context: taskContext(task, detail) } : r)));
    } catch {
      /* the summary above is already a usable reference — keep it */
    }
  }, []);

  const pick = useCallback(
    async (task: RecentTask) => {
      if (!mention) return;
      const label = mentionLabel(task);
      const applied = applyMention(draft, mention, label, caret);
      setDraft(applied.text);
      setCaret(applied.cursor);
      setDismissed(null);
      await attachReference(task, label);
    },
    [mention, draft, caret, attachReference],
  );

  // PICKING UP A PIECE OF WORK from the opening screen. Same reference the `@` picker builds, but
  // there is no mention to replace — the box is empty — so the token is appended rather than
  // spliced. Appended, not assigned, for the same reason the `sam://ask` link appends: a card tap
  // must not eat something already typed.
  const resume = useCallback(
    async (task: RecentTask) => {
      const label = mentionLabel(task);
      setDraft((d) => {
        const head = d.trim();
        const next = head ? `${head} @${label} ` : `@${label} `;
        setCaret(next.length);
        return next;
      });
      await attachReference(task, label);
    },
    [attachReference],
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

    // THE MOMENT BEFORE IT SPENDS. Nothing is sent, nothing is cleared, the draft stays exactly
    // where it is — the card replaces the send rather than interrupting one. See lib/consent.ts
    // for why `auto` deliberately does not trip this.
    if (!allowOnce.current && needsConsent(tier, consent)) {
      setAskingConsent(true);
      return;
    }
    allowOnce.current = false;

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
  }, [draft, busy, msgs, onNeedsPairing, tier, attached, refs, consent]);

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
          // THE OPENING. This used to be one paragraph in a bubble above an empty screen —
          // truthful, and completely inert: nothing to tap, no idea what SAM is for, and on a
          // tall phone most of the display was blank. An assistant's first screen should invite
          // a first message, not describe itself and stop.
          //
          // So: a short question, then things you can actually press. Tapping one fills the
          // composer rather than sending — you can edit it first, and nothing is spent by
          // curiosity. The starters name what SAM uniquely is (on your machine, free-first,
          // does things) rather than being generic assistant filler.
          <View style={s.opening}>
            <Text style={s.openingTitle}>What should SAM do?</Text>
            <Text style={s.openingSub}>
              Running on your own machine. Ask anything, or pick somewhere to start.
            </Text>
            <View style={s.starters}>
              {STARTERS.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setDraft(t)}
                  style={({ pressed }) => [
                    s.starter,
                    { backgroundColor: ios.fill, borderColor: ios.separator, opacity: pressed ? 0.6 : 1 },
                  ]}
                >
                  <Text style={[s.starterText, { color: ios.label }]}>{t}</Text>
                </Pressable>
              ))}
            </View>

            {/* PICK UP WHERE YOU LEFT OFF. The starters above are for someone with nothing in
                flight; this is for everyone else, and after the first week that is everyone.
                Returning to a blank screen and being asked "what should SAM do?" ignores the
                obvious answer — the thing you were already doing.

                Deliberately quiet about failure: if the yard is off, unreachable, or has never
                run anything, the whole block is simply absent. An opening screen is the wrong
                place to explain an outage, and the starters above still work without it. */}
            {yard?.on && yard.recent.length ? (
              <View style={s.resume}>
                <Text style={[s.resumeHead, { color: ios.secondaryLabel }]}>PICK UP WHERE YOU LEFT OFF</Text>
                {yard.recent.slice(0, 3).map((t) => (
                  <Pressable
                    key={t.id}
                    onPress={() => void resume(t)}
                    style={({ pressed }) => [
                      s.resumeCard,
                      { backgroundColor: ios.card, borderColor: ios.separator },
                      pressed && { backgroundColor: ios.cardPressed },
                    ]}
                  >
                    <Glyph ios={ios} glyph={taskGlyph(t.kind)} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.resumeTitle, { color: ios.label }]} numberOfLines={1}>
                        {taskTitle(t)}
                      </Text>
                      <Text style={[s.resumeSub, { color: ios.secondaryLabel }]} numberOfLines={1}>
                        {[t.state, taskWhen(t.createdAt)].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    {/* Same language as the Tasks list — a job must not read as green in one
                        place and grey in another. Running is a SPINNER on both surfaces rather
                        than a coloured dot: the tint stopped being a status (see stateTone),
                        and a static dot cannot tell you whether a job is working or wedged. */}
                    {t.state === 'running' ? (
                      <ActivityIndicator size="small" color={ios.secondaryLabel} />
                    ) : (
                      <View style={[s.resumeDot, { backgroundColor: stateTone(t.state, ios) }]} />
                    )}
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ) : (
          msgs.map((m, i) =>
            m.role === 'user' ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: this list is re-derived in full on every render, never reorders and holds no per-item state, so the index IS the stable identity.
              <View key={i} style={s.bubbleUser}>
                <Text style={s.userText}>{m.text}</Text>
              </View>
            ) : (
              // biome-ignore lint/suspicious/noArrayIndexKey: this list is re-derived in full on every render, never reorders and holds no per-item state, so the index IS the stable identity.
              <View key={i} style={s.samWrap}>
                <View style={s.bubbleSam}>
                  {m.pending && !m.text ? (
                    <ActivityIndicator color={ios.tint} />
                  ) : (
                    <Rendered text={m.text} s={s} ios={ios} />
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
        <View style={s.chipBar}>
          {attached.map((a, i) => (
            <Pressable
              // biome-ignore lint/suspicious/noArrayIndexKey: removal is BY index (see onPress), so the index is the identity this list actually uses.
              key={i}
              onPress={() => setAttached((prev) => prev.filter((_, j) => j !== i))}
              style={[s.chip, { backgroundColor: ios.fill }]}
              accessibilityRole="button"
              accessibilityLabel={`Remove attachment ${a.name || 'attachment'}`}
            >
              <Text style={[s.chipText, { color: ios.tintText }]}>{(a.name || 'attachment').slice(0, 22)}  ✕</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* What is riding along with the next message, and how to take it back off. Same chip as
          an attachment because it is the same idea — something added to the box, not typed. */}
      {liveRefs.length ? (
        <View style={s.chipBar}>
          {liveRefs.map((r) => (
            <Pressable
              key={r.id}
              onPress={() => {
                setRefs((prev) => prev.filter((x) => x.id !== r.id));
                setDraft((d) => removeMention(d, r.label));
              }}
              style={[s.chip, { backgroundColor: ios.fill }]}
              accessibilityRole="button"
              accessibilityLabel={`Remove reference ${r.label}`}
            >
              <Text style={[s.chipText, { color: ios.tintText }]}>@{r.label.slice(0, 22)}  ✕</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* WHICH BRAIN. This was three bare chips — Auto / Free only / Turbo — sitting loose under
          the composer with nothing saying what they were or what picking one would do. Three
          words, no label, no consequence stated: the single most muddled thing on the screen.

          Now it is one control INSIDE the composer showing the current choice, and the sheet it
          opens explains each option in a line. The explanation is the point: "free" and "turbo"
          mean nothing until someone says one costs nothing and the other spends credit. */}
      <Modal visible={brainPicker} transparent animationType="fade" onRequestClose={() => setBrainPicker(false)}>
        <Pressable style={s.brainScrim} onPress={() => setBrainPicker(false)}>
          {/* Claims the touch so a tap that lands on the sheet itself — the gap beside a row, the
              title — does not fall through to the scrim behind it and dismiss what you are reading.
              The responder prop rather than a Pressable with an empty handler: same effect, and it
              says "stop here" instead of "there is a button here that does nothing". */}
          <View
            style={[s.brainSheet, { backgroundColor: ios.card }]}
            onStartShouldSetResponder={() => true}
          >
            <Text style={[s.brainTitle, { color: ios.label }]}>Which brain answers</Text>
            {BRAINS.map((b, i) => (
              <Pressable
                key={b.key}
                onPress={() => { setTier(b.key); setBrainPicker(false); }}
                style={({ pressed }) => [
                  s.brainRow,
                  { borderBottomColor: ios.separator },
                  i === BRAINS.length - 1 && { borderBottomWidth: 0 },
                  pressed && { backgroundColor: ios.cardPressed },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[s.brainRowTitle, { color: ios.label }]}>{b.name}</Text>
                  <Text style={[s.brainRowSub, { color: ios.secondaryLabel }]}>{b.why}</Text>
                </View>
                {tier === b.key ? <Text style={[s.brainTick, { color: ios.tintText }]}>✓</Text> : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* THE @ PICKER — recent tasks, right above the keyboard. Never a modal: the operator is
          mid-sentence, and a sheet that takes the screen would lose the sentence. */}
      {picking ? (
        <View style={s.picker}>
          <View style={s.pickerHead}>
            <Text style={s.pickerTitle}>RECENT TASKS</Text>
            {/* Typing a space closes this on its own, but a control that says so is the
                difference between "it went away" and "I put it away". */}
            <Pressable onPress={() => setDismissed(mention!.start)} hitSlop={10}>
              <Text style={[s.pickerAction, { color: ios.tintText }]}>Dismiss</Text>
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
                    style={({ pressed }) => [s.pickerRow, s.pickerHit, pressed && { backgroundColor: ios.cardPressed }, i === hits.length - 1 && { borderBottomWidth: 0 }]}
                  >
                    <Glyph ios={ios} glyph={taskGlyph(t.kind)} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.pickerRowTitle} numberOfLines={1}>{taskTitle(t)}</Text>
                      <Text style={s.pickerRowSub} numberOfLines={1}>
                        {[t.state, t.createdAt ? new Date(t.createdAt).toLocaleString() : null].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
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

      {/* THE CONSENT CARD — inline, above the composer, beside the message it is about.
          Not a modal: a modal takes the screen away from the sentence you just wrote, and the
          decision is about that sentence. Emergent puts the same thing in the thread for the
          same reason. Three actions, in Apple's order of increasing commitment, with the
          declining one first and unemphasised. */}
      {askingConsent ? (
        <View style={[s.consent, { backgroundColor: ios.card, borderColor: ios.separator }]}>
          <Text style={[iosType.headline, { color: ios.label }]}>{consentCopy().title}</Text>
          <Text style={[iosType.footnote, { color: ios.secondaryLabel, marginTop: 4 }]}>
            {consentCopy().body}
          </Text>
          <View style={s.consentRow}>
            <Pressable
              onPress={() => {
                setAskingConsent(false);
                setTier('auto');
              }}
              accessibilityRole="button"
              accessibilityLabel="Not this time, use Auto"
              style={({ pressed }) => [s.consentBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[iosType.footnote, { color: ios.secondaryLabel, fontWeight: '600' }]}>
                Use Auto instead
              </Text>
            </Pressable>
            <Pressable
              onPress={() => {
                allowOnce.current = true;
                setAskingConsent(false);
                send();
              }}
              accessibilityRole="button"
              style={({ pressed }) => [s.consentBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[iosType.footnote, { color: ios.tintText, fontWeight: '600' }]}>Just this once</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setConsentState('always');
                setConsent('always');
                allowOnce.current = true;
                setAskingConsent(false);
                send();
              }}
              accessibilityRole="button"
              accessibilityHint="SAM will not ask again before using a paid brain"
              style={({ pressed }) => [s.consentBtn, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Text style={[iosType.footnote, { color: ios.tintText, fontWeight: '600' }]}>Always allow</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={s.composer}>
        <Pressable
          onPress={() => setSheet(true)}
          style={({ pressed }) => [s.plus, { transform: [{ scale: pressed ? 0.94 : 1 }] }]}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Attach"
          accessibilityHint="Photos, files and capabilities"
        >
          <Text style={s.plusText} allowFontScaling={false}>+</Text>
        </Pressable>
        {/* Inside the composer, beside the thing it affects — a setting that lives somewhere else
            is a setting nobody connects to the message they are about to send. */}
        <Pressable
          onPress={() => setBrainPicker(true)}
          style={({ pressed }) => [s.brainPill, { backgroundColor: ios.fill, opacity: pressed ? 0.6 : 1 }]}
          hitSlop={6}
          accessibilityRole="button"
          // The pill's own text is "Auto ▾", which read aloud is a word and a punctuation mark.
          accessibilityLabel={`Brain: ${BRAINS.find((b) => b.key === tier)?.name ?? 'Auto'}`}
          accessibilityHint="Choose which brain answers the next message"
        >
          <Text style={[s.brainPillText, { color: tier === 'auto' ? ios.secondaryLabel : ios.tintText }]}>
            {BRAINS.find((b) => b.key === tier)?.name ?? 'Auto'} ▾
          </Text>
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
              backgroundColor: busy ? ios.fill : draft.trim() || attached.length ? ios.tintFill : ios.fill,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            },
          ]}
          accessibilityRole="button"
          // One control, two jobs. "Up arrow" is what VoiceOver read before, which is the shape
          // of the glyph rather than the name of the action.
          accessibilityLabel={busy ? 'Stop' : 'Send'}
          accessibilityState={{ disabled: !busy && !draft.trim() && !attached.length }}
        >
          {/* allowFontScaling={false} on the GLYPH only. The circle is a fixed 32pt hit
              target by design and a growing character inside it clips; the control's meaning
              travels in its accessibilityLabel, which Dynamic Type does not touch. Same call
              the Glyph tile in ui.tsx already documents. */}
          <Text
            allowFontScaling={false}
            style={{ color: busy ? ios.label : draft.trim() || attached.length ? ios.onTint : ios.secondaryLabel, fontSize: 15, fontWeight: '700' }}
          >
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
      backgroundColor: ios.cardPressed,
      borderRadius: 24,
      borderBottomRightRadius: 6,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    userText: { ...iosType.body, color: ios.label, lineHeight: 22 },
    samWrap: { alignSelf: 'flex-start', maxWidth: '86%', gap: 3 },
    bubbleSam: {
      alignSelf: 'flex-start',
      maxWidth: '100%',
      backgroundColor: 'transparent',
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    samText: { ...iosType.body, color: ios.label, lineHeight: 22 },
    // The opening sits a little down the screen rather than jammed under the nav bar: on a tall
    // phone, content pinned to the top with nothing beneath it is exactly what read as unfinished.
    opening: { paddingTop: 40, paddingHorizontal: 4 },
    openingTitle: { ...iosType.title2, color: ios.label, fontWeight: '700', marginBottom: 6 },
    openingSub: { ...iosType.subhead, color: ios.secondaryLabel, lineHeight: 20, marginBottom: 18 },
    starters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    starter: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999, borderWidth: 1 },
    starterText: { ...iosType.subhead },
    inlineCode: { fontFamily: 'Menlo', fontSize: 15, color: ios.tintText },
    codeblock: {
      backgroundColor: ios.groupedBg,
      borderRadius: 10,
      marginTop: 8,
      overflow: 'hidden',
      borderWidth: metrics.hairline,
      borderColor: ios.separator,
    },
    codeblockHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: ios.card,
      borderBottomWidth: metrics.hairline,
      borderBottomColor: ios.separator,
    },
    codeblockLang: {
      fontFamily: 'Menlo',
      fontSize: 11,
      fontWeight: '700',
      color: ios.secondaryLabel,
      letterSpacing: 0.5,
    },
    copyBtn: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      backgroundColor: ios.groupedBg,
    },
    copyBtnText: {
      ...iosType.caption,
      fontWeight: '600',
      color: ios.secondaryLabel,
    },
    codeblockText: {
      fontFamily: 'Menlo',
      fontSize: 13,
      color: ios.label,
      lineHeight: 19,
      padding: 12,
    },
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
    plusText: { fontSize: 26, color: ios.tintText, lineHeight: 30, fontWeight: '300' },
    consent: {
      marginHorizontal: metrics.margin,
      marginBottom: 8,
      padding: 14,
      borderRadius: metrics.radius,
      borderWidth: metrics.hairline,
    },
    // Wraps, because three labels at accessibility text sizes will not sit on one line and the
    // declining option must never be the one that falls off the edge.
    consentRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 12 },
    consentBtn: { paddingVertical: 6, minHeight: 32, justifyContent: 'center' },
    chipBar: { flexDirection: 'row', gap: 6, paddingHorizontal: metrics.margin, paddingBottom: 6, flexWrap: 'wrap' },
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
    // Only the rows that are actually a job lay out sideways. The picker's other rows — the
    // error, "nothing has run yet" — are a single line of text and would be pushed off the
    // right edge by a flex row they never asked to be in.
    pickerHit: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    pickerRowTitle: { ...iosType.body, color: ios.label },
    pickerRowSub: { ...iosType.caption, color: ios.secondaryLabel, marginTop: 1 },
    chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
    chipText: { ...iosType.caption, fontWeight: '600' },
    resume: { marginTop: 28, gap: 8 },
    resumeHead: { ...iosType.caption, fontWeight: '700', letterSpacing: 0.6, marginBottom: 2 },
    // A card, not a list row: this sits in open space on the opening screen rather than inside a
    // grouped table, so it needs its own edge to read as a thing you can press.
    resumeCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: metrics.radius,
      borderWidth: metrics.hairline,
    },
    resumeTitle: { ...iosType.body, fontWeight: '600' },
    resumeSub: { ...iosType.caption, marginTop: 2 },
    resumeDot: { width: 8, height: 8, borderRadius: 4 },
    // The brain pill sits in the composer row, so it is sized to the 32pt controls either side of
    // it rather than to its own text — a control that changes height when the label changes from
    // 'Auto' to 'Turbo' makes the whole row twitch.
    // minHeight, not height: this one carries a WORD ("Auto", "Free only"), so it has to be
    // allowed to grow with the type the way metrics.rowMinHeight lets a row grow.
    brainPill: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 },
    brainPillText: { ...iosType.caption, fontWeight: '600' },
    brainScrim: { flex: 1, backgroundColor: ios.scrim, justifyContent: 'flex-end' },
    brainSheet: {
      borderTopLeftRadius: 14,
      borderTopRightRadius: 14,
      paddingTop: 14,
      paddingBottom: 34,
      paddingHorizontal: 16,
      // Its own top edge, so the sheet is bounded by something it owns rather than relying on
      // the scrim to out-contrast it. In dark that difference is card-grey against near-black.
      borderTopWidth: metrics.hairline,
      borderTopColor: ios.separator,
    },
    brainTitle: { ...iosType.footnote, fontWeight: '700', marginBottom: 6 },
    brainRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderBottomWidth: metrics.hairline,
    },
    brainRowTitle: { ...iosType.body, fontWeight: '600' },
    brainRowSub: { ...iosType.caption, marginTop: 2 },
    brainTick: { ...iosType.body, fontWeight: '700' },
    sendBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  });
}
