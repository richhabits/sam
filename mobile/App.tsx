import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Image,
  Modal,
  Platform,
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
import HomeScreen from './HomeScreen';
import VaultScreen from './VaultScreen';
import { claim, getHost, getToken } from './lib/api';
import { enterDemo, leaveDemo, loadDemo } from './lib/demo';
import { clearThread } from './lib/history';
import { centreWhenRoomy, contentColumn, layoutFor } from './lib/layout';
import { mentionLabel } from './lib/mentions';
import { ensurePermission, notify } from './lib/notify';
import { haptic } from './lib/haptics';
import { parsePairLink, type PairLink } from './lib/pairlink';
import { normalizeHost, pairedDespiteError } from './lib/pairstate';
import { publishWidgetState } from './lib/widgetState';
import { parseQuickLink } from './lib/quicklink';
import QRScanner from './QRScanner';
import SettingsScreen from './SettingsScreen';
import TasksScreen from './TasksScreen';
import { SamActionRow, SamField, SamRow, SamSection, SamTabBar, type SamTabKey } from './samKit';
import { samBorder, samColor, samInk, samRadius, samSpace, samType } from './lib/samTheme';

// THE POCKET — SAM, in your hand.
//
// Standalone AI out-of-the-box + seamless local desktop pairing.
// Works immediately on mobile without requiring any desktop setup,
// while unlocking computer control and yard tasks when paired with a Mac/PC.

type Surface = 'home' | 'agent' | 'tasks' | 'vault' | 'settings';

function surfaceToTabKey(s: Surface): SamTabKey {
  return s === 'agent' ? 'chat' : s === 'tasks' ? 'yard' : s;
}
function tabKeyToSurface(k: SamTabKey): Surface {
  return k === 'chat' ? 'agent' : k === 'yard' ? 'tasks' : (k as Surface);
}

export default function App() {
  const scheme = useColorScheme();
  const s = styles;

  const { width } = useWindowDimensions();
  const layout = useMemo(() => layoutFor(width), [width]);
  const column = useMemo(() => contentColumn(layout), [layout]);

  const [_paired, setPaired] = useState<boolean>(false);
  // Home. New screen, becomes the launch tab (design_handoff_sam_clients/README.md, "Build
  // order" step 4) — everything else here used to open straight into Agent.
  const [surface, setSurface] = useState<Surface>('home');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [host, setHostInput] = useState('http://127.0.0.1:8787');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [showPairModal, setShowPairModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Restored in the same breath as the token: every transport reads the demo flag
        // synchronously, so setting it late would let the first render's requests race ahead
        // of it and hit the real network.
        const [token, saved, inDemo] = await Promise.all([getToken(), getHost(), loadDemo()]);
        if (claimed.current) return;
        if (saved) setHostInput(saved);
        setDemo(inDemo);
        const isPaired = !!token || inDemo;
        setPaired(isPaired);
        publishWidgetState({
          paired: isPaired,
          demo: inDemo,
          line: inDemo ? 'Demo mode' : isPaired ? 'Paired' : 'Ask SAM',
          detail: inDemo ? 'Sample data, not your Mac' : isPaired ? 'Connected to your computer' : 'Open the app to connect',
        });
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
        haptic.success();
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
            haptic.success();
            setShowPairModal(false);
            setSurface('agent');
            return;
          }
        } catch { /* stored-token check failed — fall through to the original pairing error */ }
        haptic.error();
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

  // Android Hardware Back Button lifecycle handling
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onBackPress = () => {
      if (showScanner) {
        setShowScanner(false);
        return true;
      }
      if (showPairModal) {
        setShowPairModal(false);
        return true;
      }
      if (menu) {
        setMenu(false);
        return true;
      }
      if (surface !== 'agent') {
        setSurface('agent');
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [showScanner, showPairModal, menu, surface]);

  const onNeedsPairing = useCallback(() => {
    setPaired(false);
  }, []);

  // The demo never held a token, so leaving only drops the flag and the chat thread — there is
  // nothing on a Mac to revoke. Reachable both from the banner's own "Leave" link and from
  // Settings → Forget this device (forgetDevice() calls leaveDemo() internally either way).
  const doLeaveDemo = useCallback(async () => {
    await leaveDemo();
    setDemo(false);
    setPaired(false);
    setResetKey((k) => k + 1);
  }, []);

  const onScanned = useCallback(
    (link: PairLink) => {
      setShowScanner(false);
      // Reopen the pairing modal so a failed claim shows its error somewhere the user can see
      // and retry — doClaim closes it again immediately on success, so this is a no-op then.
      setShowPairModal(true);
      const target = link.host || host;
      setHostInput(target);
      setCode(link.code);
      doClaim(target, link.code);
    },
    [host, doClaim],
  );

  return (
    <SafeAreaView style={[s.screen, { backgroundColor: samColor.ground }]}>
      {/* 44pt Navigation Bar */}
      <View style={s.navbar}>
        <Pressable
          onPress={() => {
            haptic.light();
            if (_paired) setShowPairModal(true);
            else setSurface('settings');
          }}
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          accessibilityRole="button"
          accessibilityLabel={_paired ? 'Desktop paired' : 'Standalone mode'}
        >
          <Image source={require('./assets/sam-mark.png')} style={s.markSmall} accessible={false} />
          <View style={[s.statusDot, { backgroundColor: _paired ? samColor.green : samColor.accent }]} />
        </Pressable>

        <View style={{ flex: 1 }} />

        <Pressable
          onPress={() => {
            haptic.light();
            setMenu((v) => !v);
          }}
          hitSlop={10}
          style={{ minWidth: 28, alignItems: 'flex-end' }}
          accessibilityRole="button"
          accessibilityLabel="More"
          accessibilityState={{ expanded: menu }}
        >
          <Text style={{ color: samColor.accent, fontSize: 22, lineHeight: 24, fontWeight: '700' }}>•••</Text>
        </Pressable>
      </View>

      {/* Top Menu Dropdown */}
      {menu ? (
        <>
          <Pressable style={s.scrim} onPress={() => setMenu(false)} />
          <View style={s.menu}>
            <Pressable
              onPress={() => {
                haptic.light();
                setMenu(false);
                setSurface('agent');
                void clearThread().then(() => setResetKey((k) => k + 1));
              }}
              style={({ pressed }) => [s.menuRow, pressed && { backgroundColor: samColor.raise2 }]}
            >
              <Text style={s.menuRowText}>New chat</Text>
            </Pressable>
            <View style={{ height: 1, backgroundColor: samBorder.default, marginLeft: samSpace.gutter }} />
            <Pressable
              onPress={() => {
                haptic.light();
                setMenu(false);
                setShowPairModal(true);
              }}
              style={({ pressed }) => [s.menuRow, pressed && { backgroundColor: samColor.raise2 }]}
            >
              <Text style={s.menuRowText}>Connect to Mac / PC</Text>
            </Pressable>
          </View>
        </>
      ) : null}

      {/* Not dismissible, and it names the way out. A demo mistaken for a live connection is
          worse than no demo: someone would read the sample jobs as their own. */}
      {demo ? (
        <View style={s.demoBar}>
          <Text style={s.demoBarText}>Demo · sample data, not connected to a SAM</Text>
          <Pressable onPress={() => void doLeaveDemo()} hitSlop={8}>
            <Text style={s.demoBarLink}>Leave</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Main Surfaces View */}
      <View style={[{ flex: 1 }, column]}>
        {surface === 'home' ? (
          <HomeScreen
            paired={_paired}
            demo={demo}
            onNeedsPairing={onNeedsPairing}
            onOpenPairing={() => setShowPairModal(true)}
            onOpenChat={() => setSurface('agent')}
            onOpenVault={() => setSurface('vault')}
            onResume={(task) => {
              // Same reference the `@` picker builds (lib/mentions.ts's mentionLabel) — ChatScreen's
              // `prompt` prop appends it to the composer, exactly like a sam://ask deep link.
              setPrompt(`@${mentionLabel(task)} `);
              setSurface('agent');
            }}
          />
        ) : surface === 'agent' ? (
          <ChatScreen onNeedsPairing={onNeedsPairing} resetKey={resetKey} prompt={prompt} />
        ) : surface === 'vault' ? (
          <VaultScreen onNeedsPairing={onNeedsPairing} />
        ) : surface === 'tasks' ? (
          <TasksScreen
            onNeedsPairing={onNeedsPairing}
            onOpenPairing={() => setShowPairModal(true)}
          />
        ) : (
          <SettingsScreen
            onForgotten={(_note) => {
              claimed.current = false;
              setDemo(false);
              setPaired(false);
            }}
            onOpenPairing={() => setShowPairModal(true)}
          />
        )}
      </View>

      {/* Bottom tab bar — samKit's SamTabBar (the handoff's fourteen-part kit), replacing the
          old top Segmented control. Surface keys differ slightly from SamTabKey's naming
          ('agent'→'chat', 'tasks'→'yard'); the two small maps below translate between them. */}
      <SamTabBar
        platform={Platform.OS === 'android' ? 'android' : 'ios'}
        value={surfaceToTabKey(surface)}
        onChange={(k) => {
          haptic.selection();
          setSurface(tabKeyToSurface(k));
        }}
        tabs={[
          { key: 'home', glyph: '◇', label: 'Home' },
          { key: 'chat', glyph: '◈', label: 'Agent' },
          { key: 'yard', glyph: '▤', label: 'Tasks' },
          { key: 'vault', glyph: '▥', label: 'Vault' },
          { key: 'settings', glyph: '⚙', label: 'Settings' },
        ]}
      />

      {/* Pairing Modal */}
      <Modal
        visible={showPairModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowPairModal(false)}
      >
        <SafeAreaView style={[s.screen, { backgroundColor: samColor.ground }]}>
          <ScrollView
            contentContainerStyle={[{ paddingBottom: 40, paddingTop: 16 }, centreWhenRoomy(layout), column]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Connect to Mac / PC</Text>
              <Pressable onPress={() => setShowPairModal(false)} hitSlop={12}>
                <Text style={s.modalDone}>Done</Text>
              </Pressable>
            </View>

            <SamSection
              header="Pair this phone"
              footer="Open SAM on your Mac/PC (Dashboard → Devices → Pair a phone), then scan the QR code shown there — or enter the local address and code by hand."
            >
              <SamActionRow
                title="Scan QR Code"
                onPress={() => {
                  // AUDIT FIX: iOS presenting QRScanner's own fullScreen Modal while this
                  // pageSheet Modal is still visible collided in RCTModalHostView — the camera
                  // view failed to present or stayed hidden behind the page sheet. Dismiss this
                  // one first; onClose/onScanned below reopen it.
                  setShowPairModal(false);
                  setShowScanner(true);
                }}
              />
            </SamSection>

            <SamSection header="Or enter manually">
              <SamField
                label="Address"
                value={host}
                onChangeText={setHostInput}
                placeholder="http://192.168.1.5:8787"
                keyboardType="url"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <SamField
                label="Code"
                value={code}
                onChangeText={setCode}
                placeholder="6-digit PIN or hex code"
                autoCapitalize="none"
                autoCorrect={false}
                mono
              />
            </SamSection>

            <SamSection footer="Connecting unlocks local file indexing, execution tools, and yard tasks on your hardware.">
              {error ? (
                <Text style={{ ...samType.bodySm, color: samColor.red, marginBottom: samSpace.rowGap }}>{error}</Text>
              ) : null}
              <SamActionRow
                title={busy ? 'Connecting…' : 'Pair with Desktop'}
                onPress={() => doClaim()}
                disabled={!host || !code}
                busy={busy}
              />
            </SamSection>

            <SamSection header="No SAM desktop yet?">
              <SamActionRow
                title="Explore the demo"
                onPress={() => {
                  haptic.light();
                  setShowPairModal(false);
                  void enterDemo().then(() => {
                    setDemo(true);
                    setPaired(true);
                    setSurface('agent');
                  });
                }}
              />
            </SamSection>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <QRScanner
        visible={showScanner}
        onClose={() => {
          setShowScanner(false);
          setShowPairModal(true); // don't strand the user with neither modal visible on Cancel
        }}
        onScanned={onScanned}
      />

      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
    </SafeAreaView>
  );
}

// A fixed dark palette, not a light/dark pair — samTheme.ts has no light variant — so this no
// longer needs recomputing per-render off a scheme/darkerColors-derived `ios` object.
const styles = StyleSheet.create({
  screen: { flex: 1 },
  navbar: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingHorizontal: samSpace.gutter,
    borderBottomWidth: 1,
    backgroundColor: samColor.raise,
    borderBottomColor: samBorder.default,
  },
  markSmall: { width: 28, height: 28, borderRadius: 6 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1 },
  menu: {
    position: 'absolute',
    top: 52,
    right: 12,
    zIndex: 2,
    minWidth: 190,
    borderRadius: samRadius.tile,
    borderWidth: 1,
    backgroundColor: samColor.raise,
    borderColor: samBorder.default,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  menuRow: { paddingHorizontal: samSpace.gutter, paddingVertical: 14 },
  menuRowText: { ...samType.body, color: samInk.primary },
  demoBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: samSpace.gutter,
    paddingVertical: 7,
    paddingHorizontal: samSpace.gutter,
    backgroundColor: samColor.amber,
  },
  demoBarText: { fontSize: 12, fontWeight: '700', color: samColor.ground },
  demoBarLink: { fontSize: 12, fontWeight: '800', textDecorationLine: 'underline', color: samColor.ground },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: samSpace.gutter,
    paddingVertical: 12,
    marginBottom: 8,
  },
  modalTitle: { fontSize: 19, fontWeight: '700', color: samInk.primary },
  modalDone: { ...samType.body, color: samColor.accent, fontWeight: '600' },
});
