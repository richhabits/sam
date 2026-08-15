import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Image,
  Modal,
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
// Standalone AI out-of-the-box + seamless local desktop pairing.
// Works immediately on mobile without requiring any desktop setup,
// while unlocking computer control and yard tasks when paired with a Mac/PC.

type Surface = 'agent' | 'tasks' | 'settings';

export default function App() {
  const scheme = useColorScheme();

  const [darkerColors, setDarkerColors] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isDarkerSystemColorsEnabled?.()
      .then((v) => alive && setDarkerColors(!!v))
      .catch(() => { /* API unsupported on this OS version — default false is fine */ });
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

  const { width } = useWindowDimensions();
  const layout = useMemo(() => layoutFor(width), [width]);
  const column = useMemo(() => contentColumn(layout), [layout]);

  const [_paired, setPaired] = useState<boolean>(false);
  const [surface, setSurface] = useState<Surface>('agent');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [host, setHostInput] = useState('http://127.0.0.1:8787');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [showPairModal, setShowPairModal] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [token, saved] = await Promise.all([getToken(), getHost()]);
        if (claimed.current) return;
        if (saved) setHostInput(saved);
        setPaired(!!token);
      } catch {
        setPaired(false);
      }
    })();
  }, []);

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
        setShowPairModal(false);
        setSurface('agent');
        const status = await ensurePermission();
        if (status === 'granted') {
          await notify('SAM', 'This phone is paired with your Mac. Notifications will reach you here.');
        }
      } catch (e: any) {
        try {
          const [storedToken, storedHost] = await Promise.all([getToken(), getHost()]);
          if (pairedDespiteError({ targetHost: base, storedHost, storedToken })) {
            claimed.current = true;
            setPaired(true);
            setShowPairModal(false);
            setSurface('agent');
            return;
          }
        } catch { /* stored-token check failed — fall through to the original pairing error */ }
        setError(e?.message || 'Pairing failed. Make sure SAM is running on your computer.');
      } finally {
        setBusy(false);
      }
    },
    [host, code],
  );

  const handledUrls = useRef<Set<string>>(new Set());
  const handledCodes = useRef<Set<string>>(new Set());

  const handleUrl = useCallback(
    (url: string | null) => {
      if (!url || handledUrls.current.has(url)) return;
      handledUrls.current.add(url);

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

  const onNeedsPairing = useCallback(() => {
    setPaired(false);
  }, []);

  return (
    <SafeAreaView style={[s.screen, { backgroundColor: ios.groupedBg }]}>
      {/* 44pt Navigation Bar */}
      <View style={[s.navbar, { backgroundColor: ios.card, borderBottomColor: ios.separator }]}>
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
          accessibilityState={{ expanded: menu }}
        >
          <Text style={[iosType.title2, { color: ios.tintText, lineHeight: 24 }]}>•••</Text>
        </Pressable>
      </View>

      {/* Top Menu Dropdown */}
      {menu ? (
        <>
          <Pressable style={s.scrim} onPress={() => setMenu(false)} />
          <View style={[s.menu, { backgroundColor: ios.card }]}>
            <Pressable
              onPress={() => {
                setMenu(false);
                setSurface('agent');
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
                setShowPairModal(true);
              }}
              style={({ pressed }) => [s.menuRow, pressed && { backgroundColor: ios.cardPressed }]}
            >
              <Text style={[iosType.body, { color: ios.label }]}>Connect to Mac / PC</Text>
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

      {/* Main Surfaces View */}
      <View style={[{ flex: 1 }, column]}>
        {surface === 'agent' ? (
          <ChatScreen ios={ios} onNeedsPairing={onNeedsPairing} resetKey={resetKey} prompt={prompt} />
        ) : surface === 'tasks' ? (
          <TasksScreen
            ios={ios}
            onNeedsPairing={onNeedsPairing}
            onOpenPairing={() => setShowPairModal(true)}
          />
        ) : (
          <SettingsScreen
            ios={ios}
            onForgotten={(_note) => {
              claimed.current = false;
              setPaired(false);
            }}
            onOpenPairing={() => setShowPairModal(true)}
          />
        )}
      </View>

      {/* Pairing Modal */}
      <Modal
        visible={showPairModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPairModal(false)}
      >
        <SafeAreaView style={[s.screen, { backgroundColor: ios.groupedBg }]}>
          <ScrollView
            contentContainerStyle={[{ paddingBottom: 40, paddingTop: 16 }, centreWhenRoomy(layout), column]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.modalHeader}>
              <Text style={[iosType.title2, { color: ios.label, fontWeight: '700' }]}>Connect to Mac / PC</Text>
              <Pressable onPress={() => setShowPairModal(false)} hitSlop={12}>
                <Text style={[iosType.body, { color: ios.tintText, fontWeight: '600' }]}>Done</Text>
              </Pressable>
            </View>

            <Section
              ios={ios}
              header="Pair this phone"
              footer="Open SAM on your Mac/PC (Dashboard → Devices → Pair a phone) and scan the QR code with your Camera app, or enter the local address and code shown there."
            >
              <Field
                ios={ios}
                label="Address"
                value={host}
                onChangeText={setHostInput}
                placeholder="http://192.168.1.5:8787"
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Field
                ios={ios}
                label="Code"
                value={code}
                onChangeText={setCode}
                placeholder="32-character hex pairing code"
                autoCapitalize="none"
                autoCorrect={false}
                mono
                last
              />
            </Section>

            <Section
              ios={ios}
              footer="Connecting unlocks local file indexing, execution tools, and yard tasks on your hardware."
            >
              {error ? <Row ios={ios} title={error} destructive /> : null}
              <ActionRow
                ios={ios}
                title={busy ? 'Connecting…' : 'Pair with Desktop'}
                onPress={() => doClaim()}
                disabled={!host || !code}
                busy={busy}
                last
              />
            </Section>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaView>
  );
}

const makeStyles = (ios: IOS) =>
  StyleSheet.create({
    screen: { flex: 1 },
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
      minWidth: 190,
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
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: metrics.margin,
      paddingVertical: 12,
      marginBottom: 8,
    },
  });
