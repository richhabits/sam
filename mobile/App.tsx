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
  useWindowDimensions,
  View,
  Image,
} from 'react-native';
import * as Linking from 'expo-linking';
import { claim, getHost, getToken } from './lib/api';
import { enterDemo, leaveDemo, loadDemo } from './lib/demo';
import { clearThread } from './lib/history';
import { ensurePermission, notify } from './lib/notify';
import { parsePairLink } from './lib/pairlink';
import { parseQuickLink } from './lib/quicklink';
import { dark, fs, light, radius, space, type Theme } from './lib/theme';
import { iosDark, iosLight, metrics, type as iosType } from './lib/ios';
import { centreWhenRoomy, contentColumn, layoutFor } from './lib/layout';
import { Segmented } from './ui';
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
  const ios = scheme === 'dark' ? iosDark : iosLight;
  const s = useMemo(() => makeStyles(t), [t]);

  // app.json has always claimed supportsTablet, and nothing ever read the window size — so on an
  // iPad every screen stretched instead of adapting. Keyed on the WINDOW rather than the device
  // because iPadOS hands the app a phone-shaped sliver in Slide Over and about half the screen in
  // Split View, both of which should lay out like a phone. See lib/layout.ts.
  const { width } = useWindowDimensions();
  const layout = useMemo(() => layoutFor(width), [width]);
  const column = useMemo(() => contentColumn(layout), [layout]);

  const [paired, setPaired] = useState<boolean | null>(null); // null = still checking on boot
  const [surface, setSurface] = useState<Surface>('agent');
  // Text a sam://ask?text=… link arrived with, handed to the chat surface to pre-fill.
  const [prompt, setPrompt] = useState<string | null>(null);
  const [host, setHostInput] = useState('http://127.0.0.1:8787');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    // Restore BOTH halves of the pairing, not just the token: a device that paired with a SAM
    // on some other address then reopened the app used to be shown the hardcoded loopback
    // default, so a re-pair after a revoke silently pointed at the wrong machine.
    //
    // WRAPPED, because `paired` starts as null and null renders a bare spinner. If either read
    // rejects, nothing ever sets it and the app sits on that spinner for as long as you care to
    // look at it — no error, no way forward, indistinguishable from "slow". Caught running the
    // Release build on a simulator, where the keychain is unavailable to an unsigned binary and
    // getItemAsync throws: the app launched, spun, and stayed spinning.
    //
    // A keychain read can also fail on a real device — first unlock after boot, a restore from
    // backup, or an OS that simply says no. None of those should cost the operator the app. So
    // treat a failed read as "not paired", which is the truthful answer (we could not read a
    // token, so we do not have one) and lands on the pairing screen, which is recoverable.
    (async () => {
      try {
        // The demo flag is restored HERE, in the same breath as the token, because every
        // transport reads it synchronously — restoring it later would let the first render's
        // requests go to the network before the flag arrived.
        const [token, saved, inDemo] = await Promise.all([getToken(), getHost(), loadDemo()]);
        if (saved) setHostInput(saved);
        setDemo(inDemo);
        setPaired(!!token || inDemo);
      } catch (e: any) {
        setPaired(false);
        setError(e?.message ? `Couldn't read this device's pairing: ${e.message}` : "Couldn't read this device's pairing.");
      }
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
      // A quick action from a widget, a Shortcut or a QR code. Checked BEFORE the pairing
      // branch, because these are different links with different parsers and a quick action must
      // not fall through that branch's `return`.
      const quick = parseQuickLink(url);
      if (quick) {
        setSurface(quick.action === 'tasks' ? 'tasks' : 'agent');
        setPrompt(quick.text);
        return;
      }

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

  const doEnterDemo = useCallback(async () => {
    await enterDemo();
    setDemo(true);
    setError('');
    setSurface('agent');
    setPaired(true);   // the surfaces render; every transport answers from the demo instead
  }, []);

  // Leaving hands the phone back to the pairing screen with nothing kept — the demo never held
  // a token, so there is nothing to revoke, only a flag to drop.
  const doLeaveDemo = useCallback(async () => {
    await leaveDemo();
    setDemo(false);
    setPaired(false);
    setResetKey((k) => k + 1);   // drop the chat thread with it
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
        {/* The pairing form is the worst offender on a big screen: a single text input stretched
            across a 12.9" iPad reads as a bug rather than a layout. Capped and centred like
            everything else. */}
        <ScrollView contentContainerStyle={[s.pairScroll, centreWhenRoomy(layout), column]} keyboardShouldPersistTaps="handled">
          {/* The halo is a soft wash that bleeds off the TOP of the screen, drawn to sit behind a
              brand row pinned up there. Once the content centres itself on a big window the brand
              row moves down and the halo is left stranded at the top as an unexplained pink blob —
              decoration that has lost the thing it was decorating reads as a rendering bug. It
              belongs to the phone layout, so it stays on the phone layout. */}
          {layout.isRegular ? null : <View style={s.halo} pointerEvents="none" />}
          <View style={s.brandRow}>
            <Image source={require('./assets/sam-mark.png')} style={[s.mark, { width: layout.markSize, height: layout.markSize }]} />
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

          {/* Without a Mac running SAM there is nothing to pair with, and a pairing form on its
              own tells you nothing about what you would be pairing with. The demo is fixed data
              and a scripted reply — labelled as such on every screen it reaches. */}
          <View style={s.card}>
            <Text style={s.title}>No SAM yet?</Text>
            <Text style={s.sub}>
              Have a look around with sample data — the same screens, answering from a fixed
              script. Nothing is sent anywhere, and you can leave it at any time.
            </Text>
            <Pressable
              onPress={() => doEnterDemo()}
              style={({ pressed }) => [
                s.secondary,
                { borderColor: t.borderStrong, transform: [{ scale: pressed ? 0.96 : 1 }] },
              ]}
            >
              <Text style={[s.primaryText, { color: t.text }]}>Explore the demo</Text>
            </Pressable>
          </View>
        </ScrollView>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.screen, { backgroundColor: ios.groupedBg }]}>
      {/* A 44pt nav bar with a hairline, the way every native app draws one — the mark is
          the leading item, the segmented control is the title view, ••• is the trailing action. */}
      <View style={[s.navbar, { backgroundColor: ios.card, borderBottomColor: ios.separator }]}>
        <Image source={require('./assets/sam-mark.png')} style={s.markSmall} />

        <View style={{ flex: 1, paddingHorizontal: 10 }}>
          <Segmented
            ios={ios}
            value={surface === 'settings' ? 'agent' : surface}
            onChange={(k) => setSurface(k)}
            options={[
              { key: 'agent', label: 'Agent' },
              { key: 'tasks', label: 'Tasks' },
            ]}
          />
        </View>

        <Pressable onPress={() => setMenu((v) => !v)} hitSlop={10} style={{ minWidth: 28, alignItems: 'flex-end' }}>
          <Text style={[iosType.title2, { color: ios.tint, lineHeight: 24 }]}>•••</Text>
        </Pressable>
      </View>

      {/* Not dismissible, and it names the way out. A demo mistaken for a live connection is
          worse than no demo: someone would read the sample jobs as their own. */}
      {demo ? (
        <View style={[s.demoBar, { backgroundColor: t.accent }]}>
          <Text style={s.demoBarText}>Demo · sample data, not connected to a SAM</Text>
          <Pressable onPress={doLeaveDemo} hitSlop={8}>
            <Text style={s.demoBarLink}>Leave</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Tapping anywhere else dismisses — a menu you can only close by hitting the same
          3 pixels again is the kind of thing that only feels fine to whoever built it. */}
      {menu ? (
        <>
          <Pressable style={s.scrim} onPress={() => setMenu(false)} />
          <View style={[s.menu, { backgroundColor: ios.card }]}>
            <Pressable
              onPress={() => {
                setMenu(false);
                setSurface('agent');
                // Clear the stored thread, then bump the key so the chat reloads from an
                // empty store rather than trusting the screen to have dropped it too.
                void clearThread().then(() => setResetKey((k) => k + 1));
              }}
              style={({ pressed }) => [s.menuRow, pressed && { backgroundColor: ios.cardPressed }]}
            >
              <Text style={[iosType.body, { color: ios.label }]}>New chat</Text>
            </Pressable>
            <View style={{ height: metrics.hairline, backgroundColor: ios.separator, marginLeft: metrics.margin }} />
            <Pressable
              onPress={() => {
                setMenu(false);
                setSurface('settings');
              }}
              style={({ pressed }) => [s.menuRow, pressed && { backgroundColor: ios.cardPressed }]}
            >
              <Text style={[iosType.body, { color: ios.label }]}>Settings</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {/* One centred column around ALL THREE surfaces rather than inside each of them: chat,
          tasks and settings then share a single definition of "how wide should this be", and a
          fourth surface added later inherits it instead of being the one that stretches. flex:1
          is required here — a maxWidth child of a flex column collapses to its content height
          without it, and the chat would render as a strip at the top of the screen. */}
      <View style={[{ flex: 1 }, column]}>
        {surface === 'agent' ? (
          <ChatScreen ios={ios} onNeedsPairing={onNeedsPairing} resetKey={resetKey} prompt={prompt} />
        ) : surface === 'tasks' ? (
          <TasksScreen ios={ios} onNeedsPairing={onNeedsPairing} />
        ) : (
          <SettingsScreen ios={ios} onForgotten={() => setPaired(false)} />
        )}
      </View>

      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },

    navbar: {
      flexDirection: 'row',
      alignItems: 'center',
      height: 44,
      paddingHorizontal: metrics.margin,
      borderBottomWidth: metrics.hairline,
    },
    markSmall: { width: 28, height: 28, borderRadius: 6 },
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
    // Outlined rather than filled: the demo is the lesser of the two doors on this screen, and
    // should not compete with Pair for the eye.
    secondary: {
      marginTop: space[3], borderRadius: radius.md, paddingVertical: 14,
      alignItems: 'center', borderWidth: 1, backgroundColor: 'transparent',
    },
    demoBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: space[3], paddingVertical: 7, paddingHorizontal: space[4],
    },
    demoBarText: { color: t.onAccent, fontSize: fs.caption, fontWeight: '700' },
    demoBarLink: { color: t.onAccent, fontSize: fs.caption, fontWeight: '700', textDecorationLine: 'underline' },
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
