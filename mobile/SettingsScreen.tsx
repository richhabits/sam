import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Switch, Text, View } from 'react-native';
import { api, forgetDevice, getHost } from './lib/api';
import { ensurePermission, notify, setSoundEnabled, soundEnabled } from './lib/notify';
import { type, type IOS } from './lib/ios';
import { Row, Screen, Section } from './ui';

// Settings, as iOS does settings: grouped inset sections with headers and footers, not one
// hand-built card. The footers are where the honest detail goes — a native app explains a
// toggle underneath it rather than hiding the explanation somewhere else.

type Device = { id: string; label: string; lastSeen: number };

export default function SettingsScreen({ ios, onForgotten }: { ios: IOS; onForgotten: () => void }) {
  const [host, setHost] = useState('');
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [sound, setSound] = useState(true);
  const [notifyStatus, setNotifyStatus] = useState('');
  const [error, setError] = useState('');

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

  const toggleSound = useCallback(async (on: boolean) => {
    setSound(on);
    await setSoundEnabled(on);
  }, []);

  return (
    <Screen ios={ios} title="Settings">
      <Section ios={ios} header="Connection" footer={error || undefined}>
        <Row ios={ios} title="SAM" value={host.replace(/^https?:\/\//, '') || '—'} last />
      </Section>

      <Section
        ios={ios}
        header="Devices on this SAM"
        footer="Every browser and phone that has paired. Revoke one from SAM on your Mac."
      >
        {devices === null ? (
          <View style={{ padding: 20 }}>
            <ActivityIndicator color={ios.tint} />
          </View>
        ) : devices.length === 0 ? (
          <Row ios={ios} title="No devices" last />
        ) : (
          devices.map((d, i) => (
            <Row
              key={d.id}
              ios={ios}
              title={d.label}
              subtitle={new Date(d.lastSeen).toLocaleString()}
              last={i === devices.length - 1}
            />
          ))
        )}
      </Section>

      <Section
        ios={ios}
        header="Notifications"
        footer={
          notifyStatus === 'granted'
            ? 'SAM can reach this phone. Every notification is redacted before it renders — a lock screen is a public surface.'
            : notifyStatus
              ? `Permission: ${notifyStatus} — enable it in iOS Settings.`
              : 'Checking…'
        }
      >
        <Row
          ios={ios}
          title="Sound"
          accessory={<Switch value={sound} onValueChange={toggleSound} trackColor={{ true: ios.green, false: undefined }} />}
        />
        <Row
          ios={ios}
          title="Send a test notification"
          onPress={() => notify('SAM', 'Test notification — this is what a task finishing looks like.')}
          last
        />
      </Section>

      <Section
        ios={ios}
        footer="Forgetting removes this phone's token from its Keychain. Nothing on your Mac changes — revoke there to close the session properly."
      >
        <Row
          ios={ios}
          title="Forget this device"
          destructive
          onPress={async () => {
            await forgetDevice();
            onForgotten();
          }}
          last
        />
      </Section>

      <Text style={[type.caption, { color: ios.tertiaryLabel, textAlign: 'center', marginTop: 24 }]}>
        S.A.M. · Smart Artificial Mind
      </Text>
    </Screen>
  );
}
