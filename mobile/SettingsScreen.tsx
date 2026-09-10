import { nativeApplicationVersion, nativeBuildVersion } from 'expo-application';
import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { api, forgetDevice, getHost } from './lib/api';
import { loadConsent, type SpendConsent, setConsent } from './lib/consent';
import { ANTHROPIC_PROVIDER, DIRECT_PROVIDERS, GEMINI_PROVIDER, getCustomKey, setCustomKey } from './lib/direct';
import { haptic } from './lib/haptics';

const ALL_PROVIDERS = [GEMINI_PROVIDER, ANTHROPIC_PROVIDER, ...DIRECT_PROVIDERS];
import { GLYPHS } from './lib/glyphs';
import { ensurePermission, notify, setSoundEnabled, soundEnabled } from './lib/notify';
import { SamActionRow, SamChevron, SamField, SamRow, SamSection, ToggleRow } from './samKit';
import { samColor, samInk, samSpace, samType } from './lib/samTheme';

type Device = { id: string; label: string; lastSeen: number };

export default function SettingsScreen({
  onForgotten,
  onOpenPairing,
}: {
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
  const [showPlainKeys, setShowPlainKeys] = useState(false);

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
    <ScrollView
      style={{ flex: 1, backgroundColor: samColor.ground }}
      contentContainerStyle={{ paddingTop: samSpace.section, paddingBottom: 40 }}
    >
      <Text style={[{ fontSize: 33, fontWeight: '700', color: samInk.primary, marginHorizontal: samSpace.gutter, marginBottom: samSpace.section }]}>
        Settings
      </Text>

      {/* CONNECTION MODE */}
      <SamSection
        header="Connection Mode"
        footer={
          host
            ? `Linked to desktop at ${host.replace(/^https?:\/\//, '')}. Falls back to Cloud AI automatically when offline.`
            : 'Running in Standalone Mode directly on your phone. Pair with your Mac/PC to unlock local files, automation, and yard workers.'
        }
      >
        <SamRow glyph={GLYPHS.connection} title="Mode" status={<StatusText text={host ? 'Desktop Link' : 'Standalone (Cloud AI)'} />} />
        {host ? (
          <SamRow glyph={GLYPHS.device} title="Desktop Node" status={<StatusText text={host.replace(/^https?:\/\//, '')} />} />
        ) : (
          <SamActionRow title="Connect to Mac / PC" onPress={() => onOpenPairing?.()} />
        )}
      </SamSection>

      {/* CLOUD BRAINS & API KEYS */}
      <SamSection
        header="Cloud AI Engine"
        footer="SAM comes with ready-to-use cloud brains. Optionally add your own API keys for unlimited direct personal quotas. Keys are stored encrypted in Keychain / Keystore."
      >
        <SamActionRow
          title={showKeys ? 'Hide API Keys' : 'Configure Custom API Keys (30+ Providers)'}
          onPress={() => {
            haptic.light();
            setShowKeys(!showKeys);
          }}
        />
        {showKeys ? (
          <>
            <ToggleRow
              title="Mask API Keys"
              sub="Hide key text on screen to prevent shoulder surfing"
              value={!showPlainKeys}
              onChange={(val) => setShowPlainKeys(!val)}
            />
            {ALL_PROVIDERS.map((p) => {
              const isSet = !!keys[p.id]?.trim();
              return (
                <SamField
                  key={p.id}
                  label={`${p.label}${p.starter ? ' (Free)' : ''}`}
                  placeholder={isSet ? '••••••••••••••••' : p.keyPlaceholder}
                  value={keys[p.id] || ''}
                  secureTextEntry={!showPlainKeys}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChangeText={(val) => {
                    setKeys((k) => ({ ...k, [p.id]: val }));
                    void setCustomKey(p.id, val);
                  }}
                  accessory={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {isSet ? <Text style={[samType.monoXs, { color: samColor.green }]}>✓ SET</Text> : null}
                      {p.getKeyUrl ? (
                        <Pressable
                          onPress={() => {
                            haptic.medium();
                            void Linking.openURL(p.getKeyUrl);
                          }}
                          hitSlop={6}
                          accessibilityRole="link"
                          accessibilityLabel={`Get ${p.label} API key`}
                        >
                          <Text style={[samType.monoXs, { color: samColor.accent }]}>GET KEY ↗</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  }
                />
              );
            })}
          </>
        ) : null}
      </SamSection>

      {/* SPENDING */}
      <SamSection
        header="Spending"
        footer={
          consent === 'always'
            ? 'SAM will use a paid brain without asking. Turn this off and it asks each time.'
            : 'SAM asks before it uses a paid brain. Local and free brains never ask, because they cost nothing.'
        }
      >
        <SamRow glyph={GLYPHS.spending} title="Paid brains" status={<StatusText text={consent === 'always' ? 'Allowed' : 'Ask every time'} />} />
        {consent === 'always' ? (
          <SamActionRow
            title="Ask me every time"
            onPress={() => {
              setConsentState('ask');
              void setConsent('ask');
            }}
          />
        ) : null}
      </SamSection>

      {/* NOTIFICATIONS */}
      <SamSection
        header="Notifications"
        footer={
          notifyStatus === 'granted'
            ? 'SAM can reach this phone. Notifications are kept concise and private.'
            : notifyStatus
              ? `Permission: ${notifyStatus} — enable it in iOS Settings.`
              : 'Checking…'
        }
      >
        <ToggleRow title="Sound" value={sound} onChange={toggleSound} />
        <SamRow
          glyph={GLYPHS.test}
          title="Send a test notification"
          onPress={() => notify('SAM', 'Test notification — SAM is running smoothly.')}
        />
      </SamSection>

      {/* ABOUT */}
      <SamSection header="About" footer="SAM is your private, fast AI assistant on mobile and desktop.">
        <SamRow glyph={GLYPHS.appearance} title="Appearance" status={<StatusText text="Follows system" />} />
        <SamRow glyph={GLYPHS.info} title="Version" status={<StatusText text={`${version} (${build})`} />} />
        <SamRow
          glyph={GLYPHS.help}
          title="Website and Documentation"
          status={<SamChevron />}
          onPress={() => void Linking.openURL('https://richhabits.github.io/sam/')}
        />
      </SamSection>

      {/* FORGET / RESET */}
      {host ? (
        <SamSection footer="Disconnects this phone from your Mac and returns to Standalone Cloud AI mode.">
          <SamActionRow
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
          />
        </SamSection>
      ) : null}

      <Text style={[samType.monoXs, { color: samInk.metadata, textAlign: 'center', marginTop: 24, marginBottom: 40 }]}>
        S.A.M. · Smart Artificial Mind
      </Text>
    </ScrollView>
  );
}

/** Right-aligned status text — SamRow's `status` slot takes any node; this is the mono-metadata
 *  equivalent of ui.tsx's Row `value` prop. */
function StatusText({ text }: { text: string }) {
  return (
    <Text style={[samType.mono, { color: samInk.metadata }]} numberOfLines={1}>
      {text}
    </Text>
  );
}

