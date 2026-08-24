import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, Switch, Text } from 'react-native';
import { api, forgetDevice, getHost } from './lib/api';
import { loadConsent, type SpendConsent, setConsent } from './lib/consent';
import { ANTHROPIC_PROVIDER, DIRECT_PROVIDERS, GEMINI_PROVIDER, getCustomKey, setCustomKey } from './lib/direct';

const ALL_PROVIDERS = [GEMINI_PROVIDER, ANTHROPIC_PROVIDER, ...DIRECT_PROVIDERS];
import { GLYPHS } from './lib/glyphs';
import { type IOS, type } from './lib/ios';
import { ensurePermission, notify, setSoundEnabled, soundEnabled } from './lib/notify';
import { ActionRow, Field, Row, Screen, Section } from './ui';

type Device = { id: string; label: string; lastSeen: number };

export default function SettingsScreen({
  ios,
  onForgotten,
  onOpenPairing,
}: {
  ios: IOS;
  onForgotten: (note?: string) => void;
  onOpenPairing?: () => void;
}) {
  const [host, setHost] = useState('');
  const [_devices, setDevices] = useState<Device[] | null>(null);
  const [sound, setSound] = useState(true);
  const [notifyStatus, setNotifyStatus] = useState('');
  const [_error, setError] = useState('');
  const [consent, setConsentState] = useState<SpendConsent>('ask');
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [showKeys, setShowKeys] = useState(false);

  const load = useCallback(async () => {
    try {
      const saved = await getHost();
      setHost(saved || '');
      if (saved) {
        try {
          const body = await api('/api/pair/devices');
          setDevices(body.devices || []);
        } catch {
          setDevices([]);
        }
      } else {
        setDevices([]);
      }
      setError('');
    } catch (_e: any) {
      setDevices([]);
    }
  }, []);

  useEffect(() => {
    load();
    soundEnabled().then(setSound);
    ensurePermission().then(setNotifyStatus);
    loadConsent().then(setConsentState);
    Promise.all(ALL_PROVIDERS.map((p) => getCustomKey(p.id).then((k) => [p.id, k || ''] as const))).then((pairs) =>
      setKeys(Object.fromEntries(pairs)),
    );
  }, [load]);

  const toggleSound = useCallback(async (on: boolean) => {
    setSound(on);
    await setSoundEnabled(on);
  }, []);

  const version = nativeApplicationVersion ?? '1.0.0';
  const build = nativeBuildVersion ?? '9';

  return (
    <Screen ios={ios} title="Settings">
      {/* CONNECTION MODE */}
      <Section
        ios={ios}
        header="Connection Mode"
        footer={
          host
            ? `Linked to desktop at ${host.replace(/^https?:\/\//, '')}. Falls back to Cloud AI automatically when offline.`
            : 'Running in Standalone Mode directly on your phone. Pair with your Mac/PC to unlock local files, automation, and yard workers.'
        }
      >
        <Row
          ios={ios}
          glyph={GLYPHS.connection}
          title="Mode"
          value={host ? 'Desktop Link' : 'Standalone (Cloud AI)'}
        />
        {host ? (
          <Row ios={ios} glyph={GLYPHS.device} title="Desktop Node" value={host.replace(/^https?:\/\//, '')} />
        ) : (
          <ActionRow
            ios={ios}
            title="Connect to Mac / PC"
            onPress={() => onOpenPairing?.()}
            last
          />
        )}
      </Section>

      {/* CLOUD BRAINS & API KEYS */}
      <Section
        ios={ios}
        header="Cloud AI Engine"
        footer="SAM comes with ready-to-use cloud brains. Optionally add your own API keys for unlimited direct personal quotas."
      >
        <ActionRow
          ios={ios}
          title={showKeys ? 'Hide API Keys' : 'Configure Custom API Keys (30+ Providers)'}
          onPress={() => setShowKeys(!showKeys)}
          last={!showKeys}
        />
        {showKeys
          ? ALL_PROVIDERS.map((p, i) => (
              <Field
                key={p.id}
                ios={ios}
                label={`${p.label}${p.starter ? ' (Free Starter)' : ''}`}
                placeholder={p.keyPlaceholder}
                value={keys[p.id] || ''}
                onChangeText={(val) => {
                  setKeys((k) => ({ ...k, [p.id]: val }));
                  void setCustomKey(p.id, val);
                }}
                autoCapitalize="none"
                autoCorrect={false}
                accessory={
                  p.getKeyUrl ? (
                    <Pressable
                      onPress={() => void Linking.openURL(p.getKeyUrl)}
                      hitSlop={6}
                      accessibilityRole="link"
                      accessibilityLabel={`Get ${p.label} API key`}
                    >
                      <Text style={[type.footnote, { color: ios.tintText, fontWeight: '600' }]}>
                        Get Key ↗
                      </Text>
                    </Pressable>
                  ) : null
                }
                last={i === ALL_PROVIDERS.length - 1}
              />
            ))
          : null}
      </Section>

      {/* SPENDING */}
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
          glyph={GLYPHS.spending}
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

      {/* NOTIFICATIONS */}
      <Section
        ios={ios}
        header="Notifications"
        footer={
          notifyStatus === 'granted'
            ? 'SAM can reach this phone. Notifications are kept concise and private.'
            : notifyStatus
              ? `Permission: ${notifyStatus} — enable it in iOS Settings.`
              : 'Checking…'
        }
      >
        <Row
          ios={ios}
          glyph={GLYPHS.sound}
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
          glyph={GLYPHS.test}
          title="Send a test notification"
          onPress={() => notify('SAM', 'Test notification — SAM is running smoothly.')}
          last
        />
      </Section>

      {/* ABOUT */}
      <Section ios={ios} header="About" footer="SAM is your private, fast AI assistant on mobile and desktop.">
        <Row ios={ios} glyph={GLYPHS.appearance} title="Appearance" value="Follows system" />
        <Row ios={ios} glyph={GLYPHS.info} title="Version" value={`${version} (${build})`} />
        <Row
          ios={ios}
          glyph={GLYPHS.help}
          title="Website and Documentation"
          onPress={() => void Linking.openURL('https://richhabits.github.io/sam/')}
          chevron
          last
        />
      </Section>

      {/* FORGET / RESET */}
      {host ? (
        <Section
          ios={ios}
          footer="Disconnects this phone from your Mac and returns to Standalone Cloud AI mode."
        >
          <ActionRow
            ios={ios}
            title="Disconnect from Desktop Mac"
            destructive
            onPress={async () => {
              const { revokedOnMac } = await forgetDevice();
              setHost('');
              onForgotten(
                revokedOnMac
                  ? undefined
                  : 'Disconnected locally. Open SAM on your Mac to revoke the token if desired.',
              );
            }}
            last
          />
        </Section>
      ) : null}

      <Text style={[type.caption, { color: ios.tertiaryLabel, textAlign: 'center', marginTop: 24, marginBottom: 40 }]}>
        S.A.M. · Smart Artificial Mind
      </Text>
    </Screen>
  );
}
