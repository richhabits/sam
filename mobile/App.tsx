import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';
import * as Linking from 'expo-linking';
import { api, claim, forgetDevice, getHost, getToken } from './lib/api';
import { ensurePermission, notify, setSoundEnabled, soundEnabled } from './lib/notify';
import { parsePairLink } from './lib/pairlink';
import { dark, fs, light, radius, space, type Theme } from './lib/theme';

type Device = { id: string; label: string; lastSeen: number };

/** SAM's tactile press — the same scale(.96) every button on the desk has. */
function Button({
  title,
  onPress,
  disabled,
  variant = 'primary',
  t,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'danger';
  t: Theme;
}) {
  const bg = disabled ? t.borderStrong : variant === 'danger' ? 'transparent' : t.accent;
  const fg = variant === 'danger' ? t.danger : t.onAccent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderRadius: radius.md,
          paddingVertical: 14,
          alignItems: 'center',
          transform: [{ scale: pressed ? 0.96 : 1 }],
          borderWidth: variant === 'danger' ? 1 : 0,
          borderColor: t.border,
        },
      ]}
    >
      <Text style={{ color: fg, fontSize: fs.base, fontWeight: '700' }}>{title}</Text>
    </Pressable>
  );
}

export default function App() {
  const scheme = useColorScheme();
  const t = scheme === 'dark' ? dark : light;
  const s = useMemo(() => makeStyles(t), [t]);

  const [paired, setPaired] = useState<boolean | null>(null); // null = still checking on boot
  const [host, setHostInput] = useState('http://127.0.0.1:8787');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [sound, setSound] = useState(true);
  const [notifyStatus, setNotifyStatus] = useState<string>('');

  useEffect(() => {
    // Restore BOTH halves of the pairing, not just the token: a device that paired with a SAM
    // on some other address then reopened the app used to be shown the hardcoded loopback
    // default, so a re-pair after a revoke silently pointed at the wrong machine.
    (async () => {
      const [token, saved, snd] = await Promise.all([getToken(), getHost(), soundEnabled()]);
      if (saved) setHostInput(saved);
      setSound(snd);
      setPaired(!!token);
    })();
  }, []);

  // Ask for notification permission only once this phone is actually paired. Asking on first
  // launch — before SAM has anything to tell you — is the prompt everyone denies.
  useEffect(() => {
    if (!paired) return;
    ensurePermission().then(setNotifyStatus);
  }, [paired]);

  const toggleSound = useCallback(async (on: boolean) => {
    setSound(on);
    await setSoundEnabled(on);
  }, []);

  const doClaim = useCallback(
    async (withHost = host, withCode = code) => {
      setError('');
      setBusy(true);
      try {
        await claim(withHost, withCode);
        setPaired(true);
        // Confirm the channel at the one moment the operator is watching for it. Pairing is
        // exactly when "will SAM actually be able to reach me?" is the open question, and a
        // silent success answers it with nothing — you'd find out days later, when the
        // notification that mattered didn't arrive. Asking here also puts the iOS permission
        // prompt at the moment it makes sense, instead of on a cold first launch.
        const status = await ensurePermission();
        setNotifyStatus(status);
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
  // Handles both the link that opened the app cold and any that arrive while it's running.
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
      // Claim straight away: the operator already authorised this by minting the code and
      // opening the link. Making them tap "Pair" afterwards adds a step and no security.
      doClaim(target, link.code);
    },
    [host, doClaim],
  );

  useEffect(() => {
    Linking.getInitialURL().then(handleUrl);
    const sub = Linking.addEventListener('url', (e) => handleUrl(e.url));
    return () => sub.remove();
  }, [handleUrl]);

  const loadDevices = useCallback(async () => {
    setError('');
    try {
      const body = await api('/api/pair/devices');
      setDevices(body.devices);
    } catch (e: any) {
      setError(e?.message || 'could not load devices');
    }
  }, []);

  useEffect(() => {
    if (paired) loadDevices();
  }, [paired, loadDevices]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadDevices();
    setRefreshing(false);
  }, [loadDevices]);

  const doForget = useCallback(async () => {
    await forgetDevice();
    setDevices(null);
    setPaired(false);
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
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
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
              // It read "ABCD-1234" once, which told everyone to expect a short numeric code and
              // got a made-up 6-digit one typed in and rejected. A placeholder is a promise about
              // the shape of the input.
              placeholder="78736a8389fc6172fa17425ae40e908f"
              placeholderTextColor={t.muted}
            />

            {error ? <Text style={s.error}>{error}</Text> : null}

            <View style={{ marginTop: space[3] }}>
              <Button
                t={t}
                title={busy ? 'Pairing…' : 'Pair'}
                onPress={() => doClaim()}
                disabled={busy || !host || !code}
              />
            </View>
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
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />
        }
      >
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
          <View style={s.pairedRow}>
            <View style={s.pill}>
              <View style={s.dot} />
              <Text style={s.pillText}>Connected</Text>
            </View>
          </View>
          <Text style={s.hostText}>{host.replace(/^https?:\/\//, '')}</Text>

          {error ? <Text style={s.error}>{error}</Text> : null}

          <Text style={s.label}>DEVICES ON THIS SAM</Text>
          {devices === null ? (
            <ActivityIndicator color={t.accent} style={{ marginVertical: space[4] }} />
          ) : devices.length === 0 ? (
            <Text style={s.sub}>No devices listed.</Text>
          ) : (
            devices.map((d) => (
              <View key={d.id} style={s.device}>
                <Text style={s.deviceLabel}>{d.label}</Text>
                <Text style={s.deviceMeta}>{new Date(d.lastSeen).toLocaleString()}</Text>
              </View>
            ))
          )}

          <Text style={s.label}>NOTIFICATIONS</Text>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Sound</Text>
              <Text style={s.rowMeta}>
                {notifyStatus === 'granted'
                  ? 'SAM can reach this phone.'
                  : notifyStatus
                    ? `Permission: ${notifyStatus} — enable it in iOS Settings.`
                    : 'Checking…'}
              </Text>
            </View>
            <Switch
              value={sound}
              onValueChange={toggleSound}
              trackColor={{ true: t.accent, false: t.borderStrong }}
            />
          </View>
          <Pressable
            onPress={() => notify('SAM', 'Test notification — this is what a task finishing looks like.')}
            style={({ pressed }) => [s.testBtn, { opacity: pressed ? 0.6 : 1 }]}
          >
            <Text style={s.testBtnText}>Send a test notification</Text>
          </Pressable>

          <View style={{ marginTop: space[4] }}>
            <Button t={t} title="Forget this device" onPress={doForget} variant="danger" />
          </View>
        </View>
      </ScrollView>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: t.bg },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg },
    scroll: { padding: space[5], paddingTop: space[6], gap: space[3] },
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
    // desk HUD sits on (--accent-soft in src/styles.css). Sized generously and pushed off the
    // top edge so it reads as light falling into the screen, not as a shape on it.
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
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[2],
      alignSelf: 'flex-start',
      backgroundColor: t.accentSoft,
      borderRadius: radius.pill,
      paddingHorizontal: space[3],
      paddingVertical: 6,
    },
    pillText: { fontSize: fs.caption, fontWeight: '700', color: t.accentText, letterSpacing: 0.5 },
    hostText: { fontSize: fs.lg, color: t.text, fontWeight: '600', marginTop: space[3] },
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
    pairedRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.ok },
    device: { borderTopWidth: 1, borderTopColor: t.border, paddingVertical: space[3] },
    deviceLabel: { fontSize: fs.body, color: t.text, fontWeight: '600' },
    deviceMeta: { fontSize: fs.caption, color: t.muted, marginTop: 2 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space[3],
      borderTopWidth: 1,
      borderTopColor: t.border,
      paddingVertical: space[3],
    },
    rowLabel: { fontSize: fs.body, color: t.text, fontWeight: '600' },
    rowMeta: { fontSize: fs.caption, color: t.muted, marginTop: 2, lineHeight: 16 },
    testBtn: { paddingVertical: space[2] },
    testBtnText: { fontSize: fs.sm, color: t.accentText, fontWeight: '600' },
  });
