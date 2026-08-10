import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Switch, Text, View } from 'react-native';
import { api, forgetDevice, getHost } from './lib/api';
import { loadConsent, type SpendConsent, setConsent } from './lib/consent';
import { type IOS, type } from './lib/ios';
import { ensurePermission, notify, setSoundEnabled, soundEnabled } from './lib/notify';
import { ActionRow, Row, Screen, Section } from './ui';

// SETTINGS, WHICH USED TO CONTAIN NO SETTINGS.
//
// Four sections, all plumbing: the server address, the paired-device list, a sound toggle and
// a way to forget the device. Nothing a person would go looking for — no appearance, no
// version, no control over what SAM may spend, no way back out of a permission already given.
// Romeo's word for it was that it had "nothing in it reflecting settings", which is exact.
//
// AND NOT ONE ICON, on the screen where iOS uses them most. Settings.app puts a tinted square
// beside every row; Manus does the same with line icons; the eye uses them to find a row
// without reading the list. ui.tsx has had that primitive since the Tasks list needed it — a
// 29pt tile with the separator inset past it — and this screen simply never used it.
//
// The marks stay monochrome typographic characters, in the tint, for the reason lib/mentions.ts
// records: anything inside Unicode's emoji-presentation ranges is drawn full-colour by iOS and
// ignores the tint entirely, which is how a settings list ends up looking like a sticker sheet.

type Device = { id: string; label: string; lastSeen: number };

export default function SettingsScreen({ ios, onForgotten }: { ios: IOS; onForgotten: () => void }) {
  const [host, setHost] = useState('');
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [sound, setSound] = useState(true);
  const [notifyStatus, setNotifyStatus] = useState('');
  const [error, setError] = useState('');
  // The standing permission to reach for a paid brain. It could be GIVEN from the composer
  // ("Always allow") and never taken back — a one-way door, which is not a permission at all.
  // This screen is where an iOS user looks for the way out, so it is where the way out lives.
  const [consent, setConsentState] = useState<SpendConsent>('ask');

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
    loadConsent().then(setConsentState);
  }, [load]);

  const toggleSound = useCallback(async (on: boolean) => {
    setSound(on);
    await setSoundEnabled(on);
  }, []);

  // THE VERSION ROW READS THE BUNDLE, NOT THE CONFIG.
  //
  // Written first as Constants.expoConfig?.version, which rendered "— (—)" on a running build —
  // app.json says 1.0.0 / 4, but expoConfig is not populated in this bare native project, so the
  // row confidently displayed nothing. A version row that cannot state a version is worse than no
  // row: it is the one place a person checks before reporting a bug.
  //
  // expo-application reads CFBundleShortVersionString and CFBundleVersion out of the installed
  // bundle, so it is the same pair App Store Connect and TestFlight show, and it cannot drift from
  // what is actually running the way a build-time config copy can.
  const version = nativeApplicationVersion ?? '—';
  const build = nativeBuildVersion ?? '—';

  return (
    <Screen ios={ios} title="Settings">
      {/* SPENDING FIRST. It is the only setting here with money behind it, and the free-first
          promise is the product's whole claim — so it leads rather than sitting under the
          plumbing. */}
      <Section
        ios={ios}
        header="Spending"
        footer={
          consent === 'always'
            ? 'SAM will use a paid brain without asking. Turn this off and it asks each time.'
            : 'SAM asks before it uses a paid brain. Local and free brains never ask, because they cost nothing.'
        }
      >
        <Row
          ios={ios}
          glyph="◈"
          title="Paid brains"
          value={consent === 'always' ? 'Allowed' : 'Ask every time'}
          last={consent !== 'always'}
        />
        {consent === 'always' ? (
          <ActionRow
            ios={ios}
            title="Ask me every time"
            onPress={() => {
              setConsentState('ask');
              void setConsent('ask');
            }}
            last
          />
        ) : null}
      </Section>

      <Section ios={ios} header="Connection" footer={error || undefined}>
        <Row ios={ios} glyph="⇄" title="SAM" value={host.replace(/^https?:\/\//, '') || '—'} last />
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
          <Row ios={ios} glyph="▣" title="No devices" last />
        ) : (
          devices.map((d, i) => (
            <Row
              key={d.id}
              ios={ios}
              glyph="▣"
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
          glyph="♪"
          title="Sound"
          accessory={
            <Switch
              value={sound}
              onValueChange={toggleSound}
              trackColor={{ true: ios.green, false: undefined }}
              accessibilityLabel="Sound"
            />
          }
        />
        <Row
          ios={ios}
          glyph="✱"
          title="Send a test notification"
          onPress={() => notify('SAM', 'Test notification — this is what a task finishing looks like.')}
          last
        />
      </Section>

      {/* APPEARANCE IS REPORTED, NOT OFFERED, and that is deliberate. SAM follows the system
          appearance; an in-app override is a second source of truth that fights iOS's own
          setting and breaks the Increase Contrast palettes lib/ios.ts derives from it. Saying
          so is better than a control that lies, or than silence where people look for one. */}
      <Section ios={ios} header="About" footer="SAM follows your system appearance, so it changes with iOS rather than fighting it.">
        <Row ios={ios} glyph="◐" title="Appearance" value="Follows system" />
        <Row ios={ios} glyph="ⓘ" title="Version" value={`${version} (${build})`} />
        <Row
          ios={ios}
          glyph="?"
          title="Help and source"
          onPress={() => void Linking.openURL('https://richhabits.github.io/sam/')}
          chevron
          last
        />
      </Section>

      <Section
        ios={ios}
        footer="Forgetting removes this phone's token from its Keychain. Nothing on your Mac changes — revoke there to close the session properly."
      >
        <ActionRow
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
