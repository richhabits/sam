import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { api, type ApiError } from './lib/api';
import { haptic } from './lib/haptics';
import { type RecentTask, taskGlyph, taskTitle, taskWhen } from './lib/mentions';
import { GlyphTile, HeroCard, SamRow, SamSectionLabel } from './samKit';
import { samBorder, samColor, samInk, samRadius, samSpace, samType } from './lib/samTheme';
import { publishWidgetState } from './lib/widgetState';

// HOME — design_handoff_sam_clients/README.md, "Screens › Home": the new launch tab, one of
// the surfaces the phone never had. Hero card → Ask it → pick up where you left off → a grid to
// the other surfaces → "the catch". Everything here is arrangement of the fourteen parts in
// samKit.tsx; the screen itself owns only the yard fetch and the taps.
//
// "Say it" (voice input) is deliberately NOT here yet: samKit's VoiceOrb is a visual, not a
// speech-to-text pipeline, and this app has no microphone/STT wiring anywhere else in the
// codebase either. Shipping a voice button with nothing behind it would be exactly the kind of
// dishonest control the handoff's own copy rules ("failures say what happened") argue against.
// "Ask it" — text, which already works — is the one CTA below.
//
// Vault is real (build order step 6, VaultScreen.tsx). Studio is a real destination in the
// handoff but doesn't exist as a screen yet (step 8) — its grid tile is disabled rather than
// pointed at nothing. FlipIt is locked to simulated/paper/beta per the handoff's own FlipIt
// section and has no mobile screen either. "Your computer" is real: it's the same pairing flow
// QRScanner.tsx already drives, just reached from here too.

type YardSummary = { on: boolean; recent: RecentTask[]; meter?: { todayTokens: number; weekTokens: number; byTier?: Record<string, number> }; queued?: number; running?: number };

export default function HomeScreen({
  onOpenChat,
  onOpenVault,
  onResume,
  onOpenPairing,
  onNeedsPairing,
  paired,
  demo = false,
}: {
  onOpenChat: () => void;
  onOpenVault: () => void;
  onResume: (task: RecentTask) => void;
  onOpenPairing: () => void;
  onNeedsPairing: () => void;
  paired: boolean;
  demo?: boolean;
}) {
  const [yard, setYard] = useState<YardSummary | null>(null);
  const [yardError, setYardError] = useState('');
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const y: any = await api('/api/yard');
      const recent = Array.isArray(y?.recent) ? y.recent : [];
      const queued = y?.queued;
      const running = y?.running;
      setYard({
        on: !!y?.on,
        recent,
        meter: y?.meter,
        queued,
        running,
      });
      setYardError('');
      const activeNow = (queued ?? 0) + (running ?? 0);
      const last = recent[0];
      publishWidgetState({
        paired: true,
        demo,
        line: demo ? 'Demo mode' : y?.on === false ? 'Yard off' : activeNow ? `${activeNow} running` : 'Yard idle',
        detail: last ? taskTitle(last) : `${recent.length} recent tasks`,
      });
    } catch (e: any) {
      if ((e as ApiError)?.status === 401) return onNeedsPairing();
      setYardError(e?.message || "Couldn't reach SAM.");
    } finally {
      loading.current = false;
    }
  }, [onNeedsPairing, demo]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = (yard?.queued ?? 0) + (yard?.running ?? 0);
  const lanes = yard?.meter?.byTier ? Object.keys(yard.meter.byTier).length : 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: samColor.ground }}
      contentContainerStyle={{ paddingTop: samSpace.section, paddingBottom: 60 }}
    >
      <View style={{ marginHorizontal: samSpace.gutter, marginBottom: samSpace.section }}>
        <HeroCard
          brain={lanes > 0 ? `${lanes} tier${lanes === 1 ? '' : 's'}` : 'Free'}
          speed={active > 0 ? `${active} active` : 'Idle'}
          lanes={String(yard?.recent.length ?? 0)}
        >
          <Text style={[samType.display, { color: samInk.primary }]}>£0.00</Text>
          <Text style={[samType.body, { color: samInk.support, marginTop: 4 }]}>spent today — it does things, and it costs you nothing</Text>
        </HeroCard>
      </View>

      <View style={{ marginHorizontal: samSpace.gutter, marginBottom: samSpace.section }}>
        <Pressable
          onPress={() => {
            haptic.medium();
            onOpenChat();
          }}
          accessibilityRole="button"
          accessibilityLabel="Ask it"
          style={({ pressed }) => ({
            minHeight: 56,
            borderRadius: 999,
            backgroundColor: pressed ? samColor.accentDk : samColor.accent,
            alignItems: 'center',
            justifyContent: 'center',
          })}
        >
          <Text style={[samType.h3, { color: samColor.ground, fontSize: 17 }]}>Ask it</Text>
        </Pressable>
      </View>

      {yard?.on && yard.recent.length ? (
        <View style={{ marginBottom: samSpace.section }}>
          <SamSectionLabel>PICK UP WHERE YOU LEFT OFF</SamSectionLabel>
          <View style={{ marginHorizontal: samSpace.gutter, gap: samSpace.rowGap }}>
            {yard.recent.slice(0, 3).map((t) => (
              <SamRow
                key={t.id}
                glyph={taskGlyph(t.kind)}
                title={taskTitle(t)}
                meta={[t.state, taskWhen(t.createdAt)].filter(Boolean).join(' · ')}
                onPress={() => onResume(t)}
              />
            ))}
          </View>
        </View>
      ) : yardError ? (
        <Text style={{ marginHorizontal: samSpace.gutter, color: samInk.metadata, marginBottom: samSpace.section }}>{yardError}</Text>
      ) : null}

      <View style={{ marginBottom: samSpace.section }}>
        <SamSectionLabel>SURFACES</SamSectionLabel>
        <View style={{ marginHorizontal: samSpace.gutter, flexDirection: 'row', flexWrap: 'wrap', gap: samSpace.rowGap }}>
          <GridTile label="Studio" glyph="◆" comingSoon />
          <GridTile
            label="Vault"
            glyph="▤"
            onPress={() => {
              haptic.medium();
              onOpenVault();
            }}
          />
          <GridTile label="FlipIt" glyph="↯" comingSoon />
          <GridTile
            label="Your computer"
            glyph="▣"
            status={paired ? 'Paired' : undefined}
            onPress={() => {
              haptic.medium();
              onOpenPairing();
            }}
          />
        </View>
      </View>

      {/* "THE CATCH" — the handoff's own honesty card, "What's the catch?" answered before
          anyone has to ask. Static copy: the non-negotiables list in the README, condensed. */}
      <View
        style={{
          marginHorizontal: samSpace.gutter,
          borderRadius: samRadius.hero,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: samBorder.emphasis,
          padding: samSpace.heroPad,
        }}
      >
        <Text style={[samType.rowTitle, { color: samInk.primary, marginBottom: 6 }]}>What's the catch?</Text>
        <Text style={[samType.body, { color: samInk.support }]}>
          SAM prefers a local model on your own machine, then free tiers, and only reaches for
          anything paid if you turn it on. Pairing a computer is always optional. Nothing leaves
          your network except the one thing Settings names plainly.
        </Text>
      </View>
    </ScrollView>
  );
}

function GridTile({
  label,
  glyph,
  onPress,
  comingSoon,
  status,
}: {
  label: string;
  glyph: string;
  onPress?: () => void;
  comingSoon?: boolean;
  status?: string;
}) {
  const disabled = !onPress;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={comingSoon ? `${label}, coming soon` : label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        width: '47.7%',
        aspectRatio: 1.3,
        borderRadius: samRadius.row,
        backgroundColor: pressed ? samColor.raise2 : samColor.raise,
        padding: samSpace.cardPad,
        justifyContent: 'space-between',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <GlyphTile glyph={glyph} />
      <View>
        <Text style={[samType.rowTitle, { color: samInk.primary }]}>{label}</Text>
        {comingSoon ? (
          <Text style={[samType.label, { color: samInk.metadata, marginTop: 2 }]}>Soon</Text>
        ) : status ? (
          <Text style={[samType.label, { color: samColor.green, marginTop: 2 }]}>{status}</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
