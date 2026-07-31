import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';
import { claim, getHost, getToken } from './lib/api';
import { clearThread } from './lib/history';
import { ensurePermission, notify } from './lib/notify';
import { parsePairLink } from './lib/pairlink';
import { dark, fs, light, radius, space, type Theme } from './lib/theme';
import ChatScreen from './ChatScreen';
import TasksScreen from './TasksScreen';
import SettingsScreen from './SettingsScreen';

// THE POCKET — SAM, in your hand.
//
// Same two surfaces the desk has (Agent | Tasks), because this is the same product in a
// smaller frame, not a companion app. Pairing gates everything: no account, no password —
// the Mac approves this phone once and the token lives in the Keychain.

type Surface = 'agent' | 'tasks' | 'settings';

export default function App() {
  const scheme = useColorScheme();
  const t = scheme === 'dark' ? dark : light;
  const s = useMemo(() => makeStyles(t), [t]);

  const [paired, setPaired] = useState<boolean | null>(null); // null = still checking on boot
  const [surface, setSurface] = useState<Surface>('agent');
  const [host, setHostInput] = useState('http://127.0.0.1:8787');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [resetKey, setResetKey] = useState(0);

  useEffect(() => {
    // Restore BOTH halves of the pairing, not just the token: a device that paired with a SAM
    // on some other address then reopened the app used to be shown the hardcoded loopback
    // default, so a re-pair after a revoke silently pointed at the wrong machine.
    (async () => {
      const [token, saved] = await Promise.all([getToken(), getHost()]);
      if (saved) setHostInput(saved);
      setPaired(!!token);
    })();
  }, []);

  // Ask for notification permission only once this phone is actually paired. Asking on first
  // launch — before SAM has anything to tell you — is the prompt everyone denies.
  useEffect(() => {
    if (paired) ensurePermission();
  }, [paired]);

  const doClaim = useCallback(
    async (withHost = host, withCode = code) => {
      setError('');
      setBusy(true);
      try {
        await claim(withHost, withCode);
        setPaired(true);
        setSurface('agent');
        // Confirm the channel at the one moment the operator is watching for it. Pairing is
        // exactly when "will SAM actually be able to reach me?" is the open question, and a
        // silent success answers it with nothing — you'd find out days later, when the
        // notification that mattered didn't arrive.
        const status = await ensurePermission();
        if (status === 'granted') {
          await notify('SAM', 'This phone is paired. Notifications will reach you here.');
        }
      } catch (e: any) {
        setError(e?.message || 'pairing failed');
      } finally {
        setBusy(false);
      }
    },
    [host, code],
  );

  // Pairing by link — the phone's version of clicking the /pair URL SAM prints on the Mac.
  // A pairing code is single-use, so handling the same link twice is ALWAYS wrong — and iOS
  // hands it over twice as a matter of course: getInitialURL() returns the URL that launched
  // the app, and the 'url' listener fires for the same one. Without this guard the first claim
  // consumed the code, the second got "already used", and a pairing that had actually SUCCEEDED
  // showed the operator a red error.
  const handledUrls = useRef<Set<string>>(new Set());

  const handleUrl = useCallback(
    (url: string | null) => {
      if (!url || handledUrls.current.has(url)) return;
      handledUrls.current.add(url);
      const link = parsePairLink(url);
      if (!link) return;
      const target = link.host || host;
      setHostInput(target);
      setCode(link.code);
      doClaim(target, link.code);
    },
    [host, doClaim],
  );

  useEffect(() => {
    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', (e) => handleUrl(e.url));
    return () => sub.remove();
  }, [handleUrl]);

  // Any surface can discover the operator revoked this device; all of them route back here.
  const onNeedsPairing = useCallback(() => {
    setPaired(false);
    setError('This device was unpaired. Pair it again to carry on.');
  }, []);

  if (paired === null) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator color={t.accent} />
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </SafeAreaView>
    );
  }

  if (!paired) {
    return (
      <SafeAreaView style={s.screen}>
        <ScrollView contentContainerStyle={s.pairScroll} keyboardShouldPersistTaps="handled">
          <View style={s.halo} pointerEvents="none" />
          <View style={s.brandRow}>
            <View style={s.mark}>
              <Text style={s.markGlyph}>◆</Text>
            </View>
            <View>
              <Text style={s.brand}>S.A.M.</Text>
              <Text style={s.brandSub}>Smart Artificial Mind</Text>
            </View>
          </View>

          <View style={s.card}>
            <Text style={s.title}>Pair this phone</Text>
            <Text style={s.sub}>
              On your Mac, open SAM and choose <Text style={s.strong}>Pair a device</Text>. Tap the
              link it shows and this phone pairs itself — or enter the code by hand below.
            </Text>

            <Text style={s.label}>SAM ADDRESS</Text>
            <TextInput
              style={s.input}
              value={host}
              onChangeText={setHostInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://100.x.y.z:8787"
              placeholderTextColor={t.muted}
            />

            <Text style={s.label}>PAIRING CODE</Text>
            <TextInput
              style={[s.input, s.codeInput]}
              value={code}
              onChangeText={setCode}
              autoCapitalize="none"
              autoCorrect={false}
              // The real thing is 32 hex characters, so the placeholder shows 32 hex characters.
              placeholder="78736a8389fc6172fa17425ae40e908f"
              placeholderTextColor={t.muted}
            />

            {error ? <Text style={s.error}>{error}</Text> : null}

            <Pressable
              onPress={() => doClaim()}
              disabled={busy || !host || !code}
              style={({ pressed }) => [
                s.primary,
                {
                  backgroundColor: busy || !host || !code ? t.borderStrong : t.accent,
                  transform: [{ scale: pressed ? 0.96 : 1 }],
                },
              ]}
            >
              <Text style={s.primaryText}>{busy ? 'Pairing…' : 'Pair'}</Text>
            </Pressable>
            <Text style={s.note}>
              The code is exchanged for a token kept in this phone's Keychain. Nothing leaves your
              network.
            </Text>
          </View>
        </ScrollView>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.header}>
        <View style={s.markSmall}>
          <Text style={s.markGlyphSmall}>◆</Text>
        </View>

        <View style={s.segment}>
          {(['agent', 'tasks'] as const).map((k) => {
            const on = surface === k;
            return (
              <Pressable
                key={k}
                onPress={() => setSurface(k)}
                style={[s.segBtn, on && { backgroundColor: t.surface }]}
              >
                <Text style={[s.segText, { color: on ? t.text : t.muted }]}>
                  {k === 'agent' ? 'Agent' : 'Tasks'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={() => setMenu((v) => !v)}
          style={({ pressed }) => [s.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
          hitSlop={8}
        >
          <Text style={[s.iconGlyph, { color: menu || surface === 'settings' ? t.accentText : t.muted }]}>
            •••
          </Text>
        </Pressable>
      </View>

      {/* Tapping anywhere else dismisses — a menu you can only close by hitting the same
          3 pixels again is the kind of thing that only feels fine to whoever built it. */}
      {menu ? (
        <>
          <Pressable style={s.scrim} onPress={() => setMenu(false)} />
          <View style={s.menu}>
            <Pressable
              onPress={() => {
                setMenu(false);
                setSurface('agent');
                // Clear the stored thread, then bump the key so the chat reloads from an
                // empty store rather than trusting the screen to have dropped it too.
                void clearThread().then(() => setResetKey((k) => k + 1));
              }}
              style={({ pressed }) => [s.menuRow, pressed && { backgroundColor: t.accentSoft }]}
            >
              <Text style={s.menuText}>New chat</Text>
            </Pressable>
            <View style={s.menuSep} />
            <Pressable
              onPress={() => {
                setMenu(false);
                setSurface('settings');
              }}
              style={({ pressed }) => [s.menuRow, pressed && { backgroundColor: t.accentSoft }]}
            >
              <Text style={s.menuText}>Settings</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {surface === 'agent' ? (
        <ChatScreen t={t} onNeedsPairing={onNeedsPairing} resetKey={resetKey} />
      ) : surface === 'tasks' ? (
        <TasksScreen t={t} onNeedsPairing={onNeedsPairing} />
      ) : (
        <SettingsScreen t={t} onForgotten={() => setPaired(false)} />
      )}

      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },

    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[3],
      paddingHorizontal: space[4],
      paddingVertical: space[2],
      borderBottomWidth: 1,
      borderBottomColor: t.border,
    },
    markSmall: {
      width: 30,
      height: 30,
      borderRadius: radius.sm,
      backgroundColor: t.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    markGlyphSmall: { color: t.onAccent, fontSize: fs.sm, lineHeight: 16 },
    // The desk's own Agent/Tasks toggle, pill-shaped for a thumb.
    segment: {
      flex: 1,
      flexDirection: 'row',
      backgroundColor: t.accentSoft,
      borderRadius: radius.pill,
      padding: 3,
    },
    segBtn: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: radius.pill },
    segText: { fontSize: fs.md, fontWeight: '700' },
    iconBtn: { width: 30, alignItems: 'center' },
    iconGlyph: { fontSize: fs.base, fontWeight: '800' },
    scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 },
    menu: {
      position: 'absolute',
      top: 52,
      right: space[3],
      zIndex: 2,
      minWidth: 180,
      backgroundColor: t.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: t.border,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
    },
    menuRow: { paddingHorizontal: space[4], paddingVertical: 14 },
    menuText: { color: t.text, fontSize: fs.body, fontWeight: '600' },
    menuSep: { height: 1, backgroundColor: t.border },

    pairScroll: { padding: space[5], paddingTop: space[6], gap: space[3] },
    card: {
      backgroundColor: t.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: t.border,
      padding: space[5],
      shadowColor: '#000',
      shadowOpacity: 0.05,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 4 },
    },
    // A soft terracotta bloom behind the card — the phone's echo of the radial accent wash the
    // desk HUD sits on (--accent-soft in src/styles.css).
    halo: {
      position: 'absolute',
      top: -260,
      left: -120,
      right: -120,
      height: 460,
      borderRadius: 999,
      backgroundColor: t.accentSoft,
      opacity: 0.9,
    },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginBottom: space[2] },
    mark: {
      width: 38,
      height: 38,
      borderRadius: radius.md,
      backgroundColor: t.accent,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: t.accent,
      shadowOpacity: 0.35,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
    },
    markGlyph: { color: t.onAccent, fontSize: fs.base, lineHeight: 20 },
    brand: { fontSize: fs.lg, fontWeight: '800', letterSpacing: 1.5, color: t.text },
    brandSub: { fontSize: fs.caption, color: t.muted, letterSpacing: 0.3, marginTop: 1 },
    title: { fontSize: fs['2xl'], fontWeight: '700', color: t.text, letterSpacing: -0.5 },
    sub: { fontSize: fs.body, color: t.muted, lineHeight: 22, marginTop: space[2] },
    strong: { color: t.text, fontWeight: '600' },
    label: {
      fontSize: fs.micro,
      fontWeight: '700',
      letterSpacing: 1,
      color: t.muted,
      marginTop: space[4],
      marginBottom: space[2],
    },
    input: {
      borderWidth: 1,
      borderColor: t.borderStrong,
      backgroundColor: t.bg,
      color: t.text,
      borderRadius: radius.md,
      paddingHorizontal: space[3],
      paddingVertical: space[3],
      fontSize: fs.base,
    },
    // Monospace, because it's a 32-character hex string being checked character by character
    // against a screen across the room.
    codeInput: { fontFamily: 'Menlo', fontSize: fs.md, letterSpacing: 0.5 },
    primary: { marginTop: space[3], borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
    primaryText: { color: t.onAccent, fontSize: fs.base, fontWeight: '700' },
    error: {
      color: t.danger,
      fontSize: fs.sm,
      marginTop: space[3],
      backgroundColor: 'rgba(239,68,68,.10)',
      borderRadius: radius.sm,
      padding: space[3],
      overflow: 'hidden',
    },
    note: { fontSize: fs.caption, color: t.muted, marginTop: space[4], lineHeight: 18 },
  });
