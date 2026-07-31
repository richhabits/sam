import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { api, forgetDevice, getHost } from './lib/api';
import { ensurePermission, notify, setSoundEnabled, soundEnabled } from './lib/notify';
import { fs, radius, space, type Theme } from './lib/theme';

// SETTINGS — what used to be the whole app.
//
// Connection, the device registry, notifications and "forget this device" are all things you
// touch once and then never again, so they belong behind the ••• rather than in front of the
// thing you open the app to do. Same content as before, moved.

type Device = { id: string; label: string; lastSeen: number };

export default function SettingsScreen({
  t,
  onForgotten,
}: {
  t: Theme;
  onForgotten: () => void;
}) {
  const s = useMemo(() => makeStyles(t), [t]);
  const [host, setHost] = useState('');
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [sound, setSound] = useState(true);
  const [notifyStatus, setNotifyStatus] = useState('');
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [body, saved] = await Promise.all([api('/api/pair/devices'), getHost()]);
      setDevices(body.devices);
      setHost(saved || '');
      setError('');
    } catch (e: any) {
      setError(e?.message || 'could not load devices');
    }
  }, []);

  useEffect(() => {
    load();
    soundEnabled().then(setSound);
    ensurePermission().then(setNotifyStatus);
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const toggleSound = useCallback(async (on: boolean) => {
    setSound(on);
    await setSoundEnabled(on);
  }, []);

  const doForget = useCallback(async () => {
    await forgetDevice();
    onForgotten();
  }, [onForgotten]);

  return (
    <ScrollView
      contentContainerStyle={s.scroll}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.accent} />}
    >
      <View style={s.card}>
        <View style={s.pill}>
          <View style={s.dot} />
          <Text style={s.pillText}>Connected</Text>
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
          <Switch value={sound} onValueChange={toggleSound} trackColor={{ true: t.accent, false: t.borderStrong }} />
        </View>
        <Pressable
          onPress={() => notify('SAM', 'Test notification — this is what a task finishing looks like.')}
          style={({ pressed }) => [s.testBtn, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Text style={s.testBtnText}>Send a test notification</Text>
        </Pressable>

        <Pressable
          onPress={doForget}
          style={({ pressed }) => [s.forget, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}
        >
          <Text style={s.forgetText}>Forget this device</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    scroll: { padding: space[4], paddingBottom: space[6] },
    card: {
      backgroundColor: t.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: t.border,
      padding: space[5],
    },
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
    dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: t.ok },
    hostText: { fontSize: fs.lg, color: t.text, fontWeight: '600', marginTop: space[3] },
    sub: { fontSize: fs.body, color: t.muted, lineHeight: 22, marginTop: space[2] },
    label: {
      fontSize: fs.micro,
      fontWeight: '700',
      letterSpacing: 1,
      color: t.muted,
      marginTop: space[4],
      marginBottom: space[2],
    },
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
    forget: {
      marginTop: space[4],
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: radius.md,
      paddingVertical: 14,
      alignItems: 'center',
    },
    forgetText: { color: t.danger, fontSize: fs.base, fontWeight: '700' },
    error: {
      color: t.danger,
      fontSize: fs.sm,
      marginTop: space[3],
      backgroundColor: 'rgba(239,68,68,.10)',
      borderRadius: radius.sm,
      padding: space[3],
      overflow: 'hidden',
    },
  });
}
