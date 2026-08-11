import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from 'react-native';
import ChatScreen from './ChatScreen';
import { claim, getHost, getToken } from './lib/api';
import { enterDemo, leaveDemo, loadDemo } from './lib/demo';
import { clearThread } from './lib/history';
import { type IOS, type as iosType, metrics, paletteFor } from './lib/ios';
import { centreWhenRoomy, contentColumn, layoutFor } from './lib/layout';
import { ensurePermission, notify } from './lib/notify';
import { parsePairLink } from './lib/pairlink';
import { normalizeHost, pairedDespiteError } from './lib/pairstate';
import { parseQuickLink } from './lib/quicklink';
import SettingsScreen from './SettingsScreen';
import TasksScreen from './TasksScreen';
import { ActionRow, Field, Row, Section, Segmented } from './ui';

// THE POCKET — SAM, in your hand.
//
// Same two surfaces the desk has (Agent | Tasks), because this is the same product in a
// smaller frame, not a companion app. Pairing gates everything: no account, no password —
// the Mac approves this phone once and the token lives in the Keychain.

type Surface = 'agent' | 'tasks' | 'settings';

export default function App() {
  const scheme = useColorScheme();

  // Increase Contrast (Settings ▸ Accessibility ▸ Display & Text Size). iOS darkens its own
  // label colours when this is on; SAM hardcodes those hexes, so without this it took Apple's
  // values and dropped Apple's adaptation — see lib/ios.ts. Live, because the event fires and
  // a user who turns it on while the app is open should not have to relaunch.
  const [darkerColors, setDarkerColors] = useState(false);
  useEffect(() => {
    let alive = true;
    // Optional-called: the API is iOS-only and absent on older runtimes, and a missing
    // accessibility read must never be the thing that stops the app rendering.
    AccessibilityInfo.isDarkerSystemColorsEnabled?.()
      .then((v) => alive && setDarkerColors(!!v))
      .catch(() => {
        /* An unreadable accessibility setting means the default palette, never a dead app. */
      });
    const sub = AccessibilityInfo.addEventListener('darkerSystemColorsChanged', (v) =>
      setDarkerColors(!!v),
    );
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);

  const ios = useMemo(() => paletteFor(scheme, darkerColors), [scheme, darkerColors]);
  const s = useMemo(() => makeStyles(ios), [ios]);

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
        // A pairing that COMPLETED while this read was in flight wins — see `claimed`. Launching
        // from a QR banner starts both at once; this read asks a keychain that can take its time
        // (first unlock after a reboot), the claim writes a token in ~20ms, and the answer that
        // arrives late is the one from before the write. Writing it in anyway is how a paired
        // phone showed the pairing form with "This phone is paired" on its own lock screen.
        if (claimed.current) return;
        if (saved) setHostInput(saved);
        setDemo(inDemo);
        setPaired(!!token || inDemo);
      } catch (e: any) {
        if (claimed.current) return;
        setPaired(false);
        setError(e?.message ? `Couldn't read this device's pairing: ${e.message}` : "Couldn't read this device's pairing.");
      }
    })();
  }, []);

  // Ask for notification permission only once this phone is actually paired. Asking on first
  // launch — before SAM has anything to tell you — is the prompt everyone denies.
  //
  // The demo is NOT paired for this purpose, whatever `paired` says. It sets that flag to get
  // the surfaces to render, which used to trip this prompt the instant anyone opened the demo —
  // asking to send notifications from a SAM that does not exist, which is the same mistake this
  // effect already existed to avoid. Caught by running it, not by reading it.
  useEffect(() => {
    if (paired && !demo) ensurePermission();
  }, [paired, demo]);

  // Set the moment a claim actually succeeds, and never cleared. Read by the boot effect above,
  // which starts at the same instant and must not answer over the top of it with a stale
  // keychain read. A ref rather than state on purpose: the boot effect needs the CURRENT value
  // when its promise settles, not the one captured when it was created.
  const claimed = useRef(false);

  const doClaim = useCallback(
    async (withHost = host, withCode = code) => {
      setError('');
      setBusy(true);
      const base = normalizeHost(withHost);
      try {
        await claim(withHost, withCode);
        claimed.current = true;
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
        // "That code was already used" is precisely what the server says when the FIRST claim of
        // this code SUCCEEDED — so the error is evidence of a pairing, not of a failure, and
        // showing it red is how the operator ends up staring at the pairing form holding a
        // working token. Ask the keychain who is right before believing the server: a stored
        // token for THIS host means this phone is paired and should simply go through.
        //
        // Host-matched deliberately. A bare "we hold some token" would wave through a phone
        // re-pairing to a DIFFERENT Mac on the strength of its old machine's token, which is the
        // silent wrong-machine failure the boot read above already had to be fixed for.
        try {
          const [storedToken, storedHost] = await Promise.all([getToken(), getHost()]);
          if (pairedDespiteError({ targetHost: base, storedHost, storedToken })) {
            claimed.current = true;
            setPaired(true);
            setSurface('agent');
            return;
          }
        } catch {
          // Keychain unreadable — we cannot claim to know better than the server, so fall
          // through and show its error. Never swallow: an unreadable keychain that silently
          // reported success would be a phone that looks paired and can authenticate nothing.
        }
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
  //
  // Keyed on the CODE as well as the raw URL, because the two deliveries are not required to be
  // byte-identical — a trailing slash or a re-encoded query is enough for a string-keyed guard
  // to see two different URLs and let the second claim through. The code is the thing that is
  // actually single-use, so it is the thing to key on.
  const handledUrls = useRef<Set<string>>(new Set());
  const handledCodes = useRef<Set<string>>(new Set());

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
      if (handledCodes.current.has(link.code)) return;
      handledCodes.current.add(link.code);
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
        <ActivityIndicator color={ios.tint} />
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </SafeAreaView>
    );
  }

  if (!paired) {
    // THE FIRST SCREEN, AND UNTIL NOW THE ONLY ONE STILL DRAWN IN THE ABANDONED SYSTEM.
    //
    // This was 22pt shadowed cards, a 460pt pink halo bleeding off the top, uppercase
    // letter-spaced micro-labels and bordered inputs — every item lib/ios.ts's header names as
    // the "website in a phone frame" failure, on the one screen a reviewer opens cold and every
    // real user passes through before anything else. The native grammar started AFTER pairing,
    // which is exactly backwards.
    //
    // It is now the same grouped-inset vocabulary as Tasks and Settings: a large title, headers
    // and footers carrying the explanation, fields as rows, and the two doors as tinted action
    // rows. Pair leads; the demo keeps its own section rather than being demoted to fine print,
    // because a reviewer with no Mac to pair with needs one obvious tap to working content.
    return (
      <SafeAreaView style={[s.screen, { backgroundColor: ios.groupedBg }]}>
        <ScrollView
          contentContainerStyle={[{ paddingBottom: 40 }, centreWhenRoomy(layout), column]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={s.brandRow}>
            <Image
              source={require('./assets/sam-mark.png')}
              style={[s.mark, { width: layout.markSize, height: layout.markSize }]}
              accessibilityIgnoresInvertColors
              accessible={false}
            />
            <View>
              <Text style={[iosType.largeTitle, { color: ios.label }]}>SAM</Text>
              <Text style={[iosType.subhead, { color: ios.secondaryLabel }]}>Smart Artificial Mind</Text>
            </View>
          </View>

          <Section
            ios={ios}
            header="Pair this phone"
            // The Mac side (Dashboard → Pair a phone) has shown a scannable QR since 2026-08-11 —
            // this screen never said so, so the only path anyone could find was typing 32 hex
            // characters by hand. Scanning needs no button here: point iOS's own Camera app at
            // the QR on the Mac, tap the banner it offers, and the sam:// link it opens is
            // already handled by handleUrl()/doClaim() above — this footer is the only thing
            // that was actually missing.
            footer="Point your phone's Camera app at the QR code on your Mac (SAM → Dashboard → Pair a phone) and tap the banner it shows — that's it. No camera in this screen; iOS's own Camera app reads it. Prefer typing? Copy the address and code shown there instead. A code is one-time and lasts 15 minutes."
          >
            <Field
              ios={ios}
              label="Address"
              value={host}
              onChangeText={setHostInput}
              placeholder="http://100.x.y.z:8787"
              keyboardType="url"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Field
              ios={ios}
              label="Code"
              value={code}
              onChangeText={setCode}
              // The real thing is 32 hex characters, so the placeholder is 32 hex characters.
              placeholder="78736a8389fc6172fa17425ae40e908f"
              autoCapitalize="none"
              autoCorrect={false}
              mono
              last
            />
          </Section>

          {/* An outage gets a destructive ROW rather than a tinted panel of its own: the section
              is already the container, and a second boxed shape inside it is the web habit. */}
          <Section
            ios={ios}
            footer="The code is exchanged for a token kept in this phone's Keychain. Nothing leaves your network."
          >
            {error ? <Row ios={ios} title={error} destructive /> : null}
            <ActionRow
              ios={ios}
              title={busy ? 'Pairing…' : 'Pair with your Mac'}
              onPress={() => doClaim()}
              disabled={!host || !code}
              busy={busy}
              last
            />
          </Section>

          {/* Without a Mac running SAM there is nothing to pair with, and a pairing form on its
              own tells you nothing about what you would be pairing with. The demo is fixed data
              and a scripted reply — labelled as such on every screen it reaches. */}
          <Section
            ios={ios}
            header="No SAM yet?"
            footer="The same screens, answering from a fixed script. Nothing is sent anywhere, and you can leave at any time."
          >
            <ActionRow ios={ios} title="Explore the demo" onPress={() => doEnterDemo()} last />
          </Section>
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
        {/* Decoration beside a labelled control. VoiceOver reading "SAM" before the Agent /
            Tasks selector on every focus is noise, not identity. */}
        <Image source={require('./assets/sam-mark.png')} style={s.markSmall} accessible={false} />

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

        <Pressable
          onPress={() => setMenu((v) => !v)}
          hitSlop={10}
          style={{ minWidth: 28, alignItems: 'flex-end' }}
          accessibilityRole="button"
          accessibilityLabel="More"
          accessibilityHint="Settings, and leaving the demo"
          accessibilityState={{ expanded: menu }}
        >
          <Text style={[iosType.title2, { color: ios.tintText, lineHeight: 24 }]}>•••</Text>
        </Pressable>
      </View>

      {/* Not dismissible, and it names the way out. A demo mistaken for a live connection is
          worse than no demo: someone would read the sample jobs as their own. */}
      {demo ? (
        <View style={[s.demoBar, { backgroundColor: ios.tintFill }]}>
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

const makeStyles = (ios: IOS) =>
  StyleSheet.create({
    screen: { flex: 1 },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: ios.groupedBg },

    navbar: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: metrics.rowMinHeight,
      paddingHorizontal: metrics.margin,
      borderBottomWidth: metrics.hairline,
    },
    markSmall: { width: 28, height: 28, borderRadius: 6 },
    scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 },
    menu: {
      position: 'absolute',
      top: 52,
      right: 12,
      zIndex: 2,
      minWidth: 180,
      borderRadius: metrics.radius,
      borderWidth: metrics.hairline,
      borderColor: ios.separator,
      overflow: 'hidden',
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 8 },
    },
    menuRow: { paddingHorizontal: metrics.margin, paddingVertical: 14 },

    // The brand row sits above the first section rather than inside a card, which is where iOS
    // puts an app's identity on a sign-in screen.
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: metrics.margin,
      paddingTop: 12,
      paddingBottom: 4,
    },
    mark: { borderRadius: metrics.radius },

    demoBar: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 12, paddingVertical: 7, paddingHorizontal: metrics.margin,
    },
    // flexShrink so the sentence WRAPS instead of sliding off both edges of the screen at
    // accessibility text sizes — caught at accessibility-extra-large, where the band read
    // "emo · sample data, not connected to a SAM" with "Leave" cut in half. The band is the
    // one piece of chrome that must stay legible at every size, because it is the thing
    // stopping sample jobs being mistaken for real ones.
    demoBarText: { ...iosType.caption, color: ios.onTint, fontWeight: '700', flexShrink: 1 },
    demoBarLink: { ...iosType.caption, color: ios.onTint, fontWeight: '700', textDecorationLine: 'underline', flexShrink: 0 },
  });
