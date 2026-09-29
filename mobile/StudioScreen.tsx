import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native';
import { haptic } from './lib/haptics';
import { studioImageUrl } from './lib/studio';
import { SamField } from './samKit';
import { samColor, samInk, samRadius, samSpace, samType } from './lib/samTheme';

// Studio on the phone. The desktop route is optional. This screen asks Pollinations
// itself, which is the same no-key lane POST /api/studio/image tries first.
export default function StudioScreen({ onClose }: { onClose: () => void }) {
  const [prompt, setPrompt] = useState('');
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  function make() {
    const next = studioImageUrl(prompt, { seed: Math.floor(Math.random() * 1_000_000_000) });
    if (!next) return;
    haptic.medium();
    setFailed(false);
    setBusy(true);
    setUrl(next);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: samColor.ground }}
      contentContainerStyle={{ padding: samSpace.gutter, paddingBottom: 40, gap: samSpace.section }}
      keyboardShouldPersistTaps="handled"
    >
      <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to home">
        <Text style={[samType.body, { color: samColor.accent }]}>Home</Text>
      </Pressable>
      <Text style={[samType.h2, { color: samInk.primary }]}>Studio</Text>
      <Text style={[samType.body, { color: samInk.support }]}>
        Makes the picture on this phone. No Mac and no API key.
      </Text>
      <SamField
        label="Picture"
        value={prompt}
        onChangeText={setPrompt}
        placeholder="A terracotta robot, dusk, film still"
        autoCorrect
        autoCapitalize="sentences"
      />
      <Pressable
        onPress={make}
        disabled={!prompt.trim() || busy}
        accessibilityRole="button"
        accessibilityLabel="Make picture"
        style={({ pressed }) => ({
          minHeight: 52,
          borderRadius: samRadius.pill,
          backgroundColor: pressed ? samColor.accentDk : samColor.accent,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: prompt.trim() ? 1 : 0.45,
        })}
      >
        <Text style={[samType.h3, { color: samColor.ground, fontSize: 17 }]}>{busy ? 'Making…' : 'Make picture'}</Text>
      </Pressable>
      {url ? (
        <View style={{ borderRadius: samRadius.hero, overflow: 'hidden', backgroundColor: samColor.raise, minHeight: 280 }}>
          {busy ? (
            <ActivityIndicator color={samColor.accent} style={{ margin: 24 }} />
          ) : null}
          <Image
            source={{ uri: url }}
            style={{ width: '100%', aspectRatio: 1 }}
            accessible
            accessibilityLabel="Generated picture"
            onLoad={() => setBusy(false)}
            onError={() => {
              setBusy(false);
              setFailed(true);
            }}
          />
        </View>
      ) : null}
      {failed ? (
        <Text style={[samType.body, { color: samColor.amber }]}>
          The picture lane did not answer. Try again in a moment.
        </Text>
      ) : null}
    </ScrollView>
  );
}
