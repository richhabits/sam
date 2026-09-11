// THE FOURTEEN PARTS — design_handoff_sam_clients/README.md, "The fourteen parts": build these
// once, every screen in the handoff is arrangement of them. Companion to lib/samTheme.ts, which
// holds the values these components read.
//
// Reduce Motion: the orb, rings and spinner stop; the run-log step SEQUENCE stays, because per
// the handoff it is information, not decoration. Each animated part below checks
// AccessibilityInfo's reduce-motion state itself rather than trusting a prop, for the same
// reason lib/ios.ts reads darkerSystemColors live — a setting a user turned on for the OS
// should not need this app to be relaunched to take effect.

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';
import { haptic } from './lib/haptics';
import { samBorder, samColor, samInk, samMotion, samRadius, samSpace, samTouch, samType } from './lib/samTheme';

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => alive && setReduce(!!v))
      .catch(() => { /* unsupported OS version — default false */ });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduce(!!v));
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return reduce;
}

/** 1. Hero card — Home only. Terracotta-tinted border, three-cell footer. radius 18 (hero). */
export function HeroCard({
  brain,
  speed,
  lanes,
  children,
}: {
  brain: string;
  speed: string;
  lanes: string;
  children?: ReactNode;
}) {
  return (
    <View style={hero.card}>
      {children}
      <View style={hero.footer}>
        <HeroCell label="BRAIN" value={brain} />
        <View style={hero.div} />
        <HeroCell label="SPEED" value={speed} />
        <View style={hero.div} />
        <HeroCell label="LANES" value={lanes} />
      </View>
    </View>
  );
}
function HeroCell({ label, value }: { label: string; value: string }) {
  return (
    <View style={hero.cell}>
      <Text style={[samType.monoXs, { color: samInk.metadata }]}>{label}</Text>
      <Text style={[samType.rowTitle, { color: samInk.primary, marginTop: 2 }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
const hero = StyleSheet.create({
  card: {
    borderRadius: samRadius.hero,
    borderWidth: 1,
    borderColor: samBorder.accent,
    backgroundColor: samColor.raise,
    padding: samSpace.heroPad,
    marginHorizontal: samSpace.gutter,
  },
  footer: { flexDirection: 'row', marginTop: samSpace.section, gap: 0 },
  cell: { flex: 1 },
  div: { width: 1, backgroundColor: samBorder.default, marginHorizontal: 12 },
});

/** 3. Glyph tile — 30×30, radius 9, accent at 14–16% behind a mono glyph. Reused by SamRow. */
export function GlyphTile({ glyph, size = 30 }: { glyph: string; size?: number }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: samRadius.glyph,
        backgroundColor: 'rgba(240,130,78,0.15)',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      <Text allowFontScaling={false} style={[samType.mono, { color: samColor.accent }]}>
        {glyph}
      </Text>
    </View>
  );
}

/** 2. Row — glyph tile, title, mono meta, trailing status. Every list in the handoff is this
 *  row. radius 14, pad 13/14, gap 12. */
export function SamRow({
  glyph,
  title,
  meta,
  status,
  onPress,
}: {
  glyph?: string;
  title: string;
  meta?: string;
  status?: ReactNode;
  onPress?: () => void;
}) {
  const body = (pressed: boolean) => (
    <View style={[row.card, pressed && { backgroundColor: samColor.raise2 }]}>
      {glyph ? <GlyphTile glyph={glyph} /> : null}
      <View style={{ flex: 1, marginLeft: glyph ? 12 : 0 }}>
        <Text style={[samType.rowTitle, { color: samInk.primary }]} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={[samType.mono, { color: samInk.metadata, marginTop: 3 }]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      {status}
    </View>
  );
  if (!onPress) return body(false);
  return (
    <Pressable
      onPress={() => {
        haptic.light();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={[title, meta].filter(Boolean).join(', ')}
      style={{ minHeight: samTouch.minTarget }}
    >
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}
const row = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: samRadius.row,
    backgroundColor: samColor.raise,
    paddingVertical: samSpace.cardPad,
    paddingHorizontal: 14,
    minHeight: samTouch.minTarget,
  },
});

/** 4. Stat card — big Grotesk number over mono caption. Ships in twos and threes. */
export function StatCard({ value, caption }: { value: string; caption: string }) {
  return (
    <View style={stat.card}>
      <Text style={[samType.h2, { color: samInk.primary }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[samType.monoXs, { color: samInk.metadata, marginTop: 4 }]}>{caption}</Text>
    </View>
  );
}
const stat = StyleSheet.create({
  card: {
    flex: 1,
    borderRadius: samRadius.row,
    backgroundColor: samColor.raise,
    padding: samSpace.cardPad,
  },
});

export type RunStepKind = 'normal' | 'hop' | 'fail';
export type RunStep = { id: string; label: string; kind: RunStepKind };

const stepTone: Record<RunStepKind, { ink: string; mark: string; tint?: string }> = {
  normal: { ink: samInk.primary, mark: '✓' },
  hop: { ink: samColor.amber, mark: '⇢', tint: 'rgba(255,159,10,0.1)' },
  fail: { ink: samColor.red, mark: '✕', tint: 'rgba(255,69,58,0.1)' },
};

/** 5. Run log — header (spinner, state, cost) over step rows. Steps carry a kind: normal
 *  (green ✓), hop (amber ⇢, tinted row), fail (red ✕, tinted row). radius 15.
 *
 *  £0.00 on every completed run is one of the two things the whole product's promise rests on
 *  (handoff README, "Overview") — `cost` is required, not optional, so a caller cannot forget
 *  to render it. */
export function RunLog({
  state,
  cost,
  steps,
}: {
  state: 'working' | 'done' | 'failed';
  /** e.g. "£0.00" — always rendered, never omitted. */
  cost: string;
  steps: RunStep[];
}) {
  const reduceMotion = useReduceMotion();
  return (
    <View style={log.card}>
      <View style={log.header}>
        {state === 'working' ? <Spinner reduceMotion={reduceMotion} /> : null}
        <Text style={[samType.monoSm, { color: samInk.support, marginLeft: state === 'working' ? 8 : 0 }]}>
          {state === 'working' ? 'WORKING' : state === 'done' ? 'DONE' : 'FAILED'}
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={[samType.monoSm, { color: samColor.green }]}>{cost}</Text>
      </View>
      {steps.map((step, i) => (
        <RunStepRow key={step.id} step={step} index={i} reduceMotion={reduceMotion} />
      ))}
    </View>
  );
}
function RunStepRow({ step, index, reduceMotion }: { step: RunStep; index: number; reduceMotion: boolean }) {
  const tone = stepTone[step.kind];
  const rise = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return; // step sequence still renders — it is information, per the handoff
    Animated.timing(rise, {
      toValue: 1,
      duration: samMotion.stepRise,
      delay: index * samMotion.stepStagger,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [reduceMotion, rise, index]);
  return (
    <Animated.View
      style={[
        log.stepRow,
        tone.tint ? { backgroundColor: tone.tint, borderRadius: samRadius.tile } : null,
        { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] },
      ]}
    >
      <Text style={[samType.mono, { color: tone.ink }]} accessibilityElementsHidden>
        {tone.mark}
      </Text>
      <Text style={[samType.bodySm, { color: tone.ink, marginLeft: 8, flex: 1 }]}>{step.label}</Text>
    </Animated.View>
  );
}
const log = StyleSheet.create({
  card: { borderRadius: 15, backgroundColor: samColor.raise2, padding: samSpace.cardPad },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  stepRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 6 },
});

/** Only two things loop forever per the handoff: the orb while listening, the spinner while
 *  working. Both stop under Reduce Motion. */
function Spinner({ reduceMotion }: { reduceMotion: boolean }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: samMotion.spinnerTurn, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View
      accessibilityElementsHidden
      style={{
        width: 12,
        height: 12,
        borderRadius: 6,
        borderWidth: 1.5,
        borderColor: samColor.accent,
        borderTopColor: 'transparent',
        transform: reduceMotion ? undefined : [{ rotate }],
      }}
    />
  );
}

/** 6. Permission gate — amber-bordered card IN THE MESSAGE STREAM, never a modal. Scopes as
 *  mono bullets, two buttons, "not now" is first-class (same size/weight as Allow — a real
 *  decline, not a de-emphasised escape hatch). radius 16. */
export function PermissionGate({
  title,
  scopes,
  onAllow,
  onNotNow,
}: {
  title: string;
  scopes: string[];
  onAllow: () => void;
  onNotNow: () => void;
}) {
  return (
    <View style={gate.card} accessibilityRole="none">
      <Text style={[samType.rowTitle, { color: samInk.primary }]}>{title}</Text>
      <View style={{ marginTop: 10, gap: 6 }}>
        {scopes.map((scope) => (
          <View key={scope} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
            <Text style={[samType.mono, { color: samColor.amber }]}>·</Text>
            <Text style={[samType.mono, { color: samInk.support, marginLeft: 6, flex: 1 }]}>{scope}</Text>
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <Pressable
          onPress={() => {
            haptic.light();
            onNotNow();
          }}
          accessibilityRole="button"
          style={[gate.btn, { backgroundColor: 'transparent', borderWidth: 1, borderColor: samBorder.emphasis }]}
        >
          <Text style={[samType.rowTitle, { color: samInk.primary }]}>Not now</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            haptic.medium();
            onAllow();
          }}
          accessibilityRole="button"
          style={[gate.btn, { backgroundColor: samColor.accent }]}
        >
          <Text style={[samType.rowTitle, { color: samColor.ground }]}>Allow</Text>
        </Pressable>
      </View>
    </View>
  );
}
const gate = StyleSheet.create({
  card: {
    borderRadius: samRadius.hero,
    borderWidth: 1,
    borderColor: 'rgba(255,159,10,0.35)',
    backgroundColor: 'rgba(255,159,10,0.06)',
    padding: 16,
  },
  btn: { flex: 1, minHeight: samTouch.minTarget, borderRadius: samRadius.pill, alignItems: 'center', justifyContent: 'center' },
});

/** 7. Chip — follow-ups and filters. Mono uppercase, min-height 44. */
export function SamChip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={() => {
        haptic.selection();
        onPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      style={[
        chip.pill,
        { backgroundColor: on ? samColor.accent : samColor.raise, borderColor: on ? samColor.accent : samBorder.default },
      ]}
    >
      <Text style={[samType.monoXs, { color: on ? samColor.ground : samInk.support }]}>{label}</Text>
    </Pressable>
  );
}
const chip = StyleSheet.create({
  pill: {
    minHeight: samTouch.minTarget,
    paddingHorizontal: 14,
    borderRadius: samRadius.pill,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/** 8. Sheet — bottom sheet, grab handle, 60% black scrim. radius 26 top. rise 8px + fade,
 *  260ms, no spring — per the handoff's motion table, so this does NOT use the platform's
 *  native spring-based Modal presentation. */
export function SamSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(rise, {
      toValue: visible ? 1 : 0,
      duration: samMotion.sheetRise,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [visible, rise]);
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={sheet.scrim} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
      <Animated.View
        style={[
          sheet.card,
          {
            opacity: rise,
            transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }],
          },
        ]}
      >
        <View style={sheet.handle} />
        {children}
      </Animated.View>
    </Modal>
  );
}
const sheet = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
  card: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '85%',
    backgroundColor: samColor.raise2,
    borderTopLeftRadius: samRadius.sheetTop,
    borderTopRightRadius: samRadius.sheetTop,
    paddingTop: 10,
    paddingBottom: 24,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: samBorder.emphasis, alignSelf: 'center', marginBottom: 12 },
});

export type SamTabKey = 'home' | 'chat' | 'yard' | 'studio' | 'vault' | 'settings' | 'flip' | 'pair';

/** 9. Tab bar — five tabs. iOS: 2px underline. Android: filled pill behind the glyph. */
export function SamTabBar({
  platform,
  tabs,
  value,
  onChange,
}: {
  platform: 'ios' | 'android';
  tabs: { key: SamTabKey; glyph: string; label: string }[];
  value: SamTabKey;
  onChange: (k: SamTabKey) => void;
}) {
  return (
    <View style={tabbar.bar} accessibilityRole="tablist">
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <Pressable
            key={t.key}
            onPress={() => {
              haptic.selection();
              onChange(t.key);
            }}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: on }}
            hitSlop={12}
            style={tabbar.item}
          >
            {platform === 'android' && on ? <View style={tabbar.pill} /> : null}
            <Text style={[samType.mono, { color: on ? samColor.accent : samInk.metadata }]}>{t.glyph}</Text>
            <Text style={[samType.monoXs, { color: on ? samColor.accent : samInk.metadata, marginTop: 3 }]}>{t.label}</Text>
            {platform === 'ios' && on ? <View style={tabbar.underline} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
const tabbar = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: samColor.ground2,
    borderTopWidth: 1,
    borderTopColor: samBorder.default,
    // Home indicator was eating taps on Agent / Settings. Keep labels above it.
    paddingBottom: 18,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, minHeight: samTouch.minTarget },
  underline: { position: 'absolute', top: 0, width: 24, height: 2, backgroundColor: samColor.accent, borderRadius: 1 },
  pill: { position: 'absolute', top: 2, width: 44, height: 26, borderRadius: 13, backgroundColor: 'rgba(240,130,78,0.15)' },
});

/** 10. Toggle row — title, sub, 46×28 track, knob 22 travelling 3→21. */
export function ToggleRow({
  title,
  sub,
  value,
  onChange,
}: {
  title: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const knob = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(knob, { toValue: value ? 1 : 0, duration: samMotion.toggleKnob, useNativeDriver: true }).start();
  }, [value, knob]);
  return (
    <Pressable
      onPress={() => {
        haptic.light();
        onChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={[title, sub].filter(Boolean).join(', ')}
      style={toggle.row}
    >
      <View style={{ flex: 1 }}>
        <Text style={[samType.rowTitle, { color: samInk.primary }]}>{title}</Text>
        {sub ? <Text style={[samType.bodySm, { color: samInk.support, marginTop: 2 }]}>{sub}</Text> : null}
      </View>
      <View style={[toggle.track, { backgroundColor: value ? samColor.accent : samBorder.emphasis }]}>
        <Animated.View
          style={[
            toggle.knob,
            { transform: [{ translateX: knob.interpolate({ inputRange: [0, 1], outputRange: [3, 21] }) }] },
          ]}
        />
      </View>
    </Pressable>
  );
}
const toggle = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', minHeight: samTouch.minTarget, paddingVertical: 8 },
  track: { width: 46, height: 28, borderRadius: 14, justifyContent: 'center' },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: samColor.ink, position: 'absolute' },
});

/** 11. Empty state — dashed glyph box, 26px headline, one sentence, one button. Never an
 *  illustration. */
export function EmptyState({
  glyph,
  title,
  body,
  actionLabel,
  onAction,
}: {
  glyph: string;
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={empty.wrap}>
      <View style={empty.box}>
        <Text style={[samType.h3, { color: samInk.metadata }]}>{glyph}</Text>
      </View>
      <Text style={[{ fontSize: 26, fontWeight: '700', color: samInk.primary, marginTop: 18 }]}>{title}</Text>
      <Text style={[samType.body, { color: samInk.support, marginTop: 6, textAlign: 'center' }]}>{body}</Text>
      {actionLabel && onAction ? (
        <Pressable
          onPress={() => {
            haptic.medium();
            onAction();
          }}
          accessibilityRole="button"
          style={{
            marginTop: 18,
            minHeight: samTouch.minTarget,
            paddingHorizontal: 20,
            borderRadius: samRadius.pill,
            backgroundColor: samColor.accent,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={[samType.rowTitle, { color: samColor.ground }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
const empty = StyleSheet.create({
  wrap: { alignItems: 'center', paddingHorizontal: samSpace.gutter, paddingVertical: 40 },
  box: {
    width: 64,
    height: 64,
    borderRadius: samRadius.tile,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: samBorder.emphasis,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/** 12. Banner — full-width amber strip under the top bar. Offline only. */
export function Banner({ text }: { text: string }) {
  return (
    <View style={banner.bar} accessibilityRole="alert">
      <Text style={[samType.monoXs, { color: samColor.ground }]}>{text}</Text>
    </View>
  );
}
const banner = StyleSheet.create({
  bar: { backgroundColor: samColor.amber, paddingVertical: 8, alignItems: 'center', justifyContent: 'center' },
});

/** 13. Voice orb — 120px radial gradient, two expanding rings, glow. RN core has no gradient
 *  primitive without expo-linear-gradient (not yet a dependency); approximated here with a
 *  solid accent fill + shadow glow, which is close but not the literal radial gradient the
 *  handoff specifies — swap in expo-linear-gradient once it's added as a dependency. */
export function VoiceOrb({ listening }: { listening: boolean }) {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!listening || reduceMotion) return;
    const loops = [
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1, duration: samMotion.orbPulse / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 0, duration: samMotion.orbPulse / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        ]),
      ),
      Animated.loop(Animated.timing(ring1, { toValue: 1, duration: 2400, easing: Easing.out(Easing.ease), useNativeDriver: true })),
      Animated.loop(
        Animated.sequence([
          Animated.delay(samMotion.ringOffset),
          Animated.timing(ring2, { toValue: 1, duration: 2400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        ]),
      ),
    ];
    for (const l of loops) l.start();
    return () => {
      for (const l of loops) l.stop();
    };
  }, [listening, reduceMotion, pulse, ring1, ring2]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const ringStyle = (v: Animated.Value) => ({
    opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0] }),
    transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.6] }) }],
  });
  return (
    <View style={orb.wrap} accessibilityElementsHidden>
      {listening && !reduceMotion ? <Animated.View style={[orb.ring, ringStyle(ring1)]} /> : null}
      {listening && !reduceMotion ? <Animated.View style={[orb.ring, ringStyle(ring2)]} /> : null}
      <Animated.View style={[orb.core, { transform: listening && !reduceMotion ? [{ scale }] : undefined }]} />
    </View>
  );
}
const orb = StyleSheet.create({
  wrap: { width: 120, height: 120, alignItems: 'center', justifyContent: 'center' },
  core: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: samColor.accent,
    shadowColor: samColor.accent,
    shadowOpacity: 0.45,
    shadowRadius: 70,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  ring: { position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 1.5, borderColor: samColor.accentLt },
});

/** 14. Tile grid — 2-up squares for Studio output. radius 14, gap 9. */
export function TileGrid({ children }: { children: ReactNode[] }) {
  return <View style={grid.wrap}>{children}</View>;
}
export function Tile({ children }: { children: ReactNode }) {
  return <View style={grid.tile}>{children}</View>;
}
const grid = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  tile: { width: '47.7%', aspectRatio: 1, borderRadius: samRadius.row, backgroundColor: samColor.raise, overflow: 'hidden' },
});

/** Horizontal scroller for chip rows / stat card pairs, so screens don't each re-derive the
 *  gutter + gap spacing rule from lib/samTheme.ts. */
export function SamHScroll({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: samSpace.gutter, gap: samSpace.rowGap }}
    >
      {children}
    </ScrollView>
  );
}

/** Section label — "11px above its content", mono, per the handoff's spacing rules. */
/** Screen H1 — same 33pt Grotesk, same gutter, on every list surface. */
export function ScreenTitle({ children }: { children: string }) {
  return (
    <Text style={[samType.h1, { color: samInk.primary, marginHorizontal: samSpace.gutter, marginBottom: samSpace.section }]}>
      {children}
    </Text>
  );
}

export function SamSectionLabel({ children }: { children: string }) {
  return (
    <Text
      style={[
        samType.label,
        { color: samInk.metadata, marginHorizontal: samSpace.gutter, marginBottom: samSpace.sectionLabel },
      ]}
    >
      {children}
    </Text>
  );
}

/** A labelled group of rows with an optional footer — the flat-card language's answer to the
 *  Apple-grouped-list Section (header/footer/rounded card) that ui.tsx's screens used. SamRow
 *  itself is a standalone card with no built-in grouping, so screens carrying real header/footer
 *  copy (why this group exists, what a tap does) need this rather than re-deriving the same
 *  label+gap+footnote arrangement per screen. */
export function SamSection({ header, footer, children }: { header?: string; footer?: string; children: ReactNode }) {
  return (
    <View style={{ marginBottom: samSpace.section }}>
      {header ? <SamSectionLabel>{header.toUpperCase()}</SamSectionLabel> : null}
      <View style={{ marginHorizontal: samSpace.gutter, gap: samSpace.rowGap }}>{children}</View>
      {footer ? (
        <Text style={[samType.bodySm, { color: samInk.metadata, marginHorizontal: samSpace.gutter, marginTop: samSpace.rowGap }]}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/** Trailing "drill in" indicator for a SamRow's `status` slot — SamRow has no built-in chevron
 *  concept of its own, its status slot takes any node. */
export function SamChevron() {
  return <Text style={[samType.mono, { color: samInk.metadata }]}>›</Text>;
}

/** Centred, accent-coloured CTA row (red when destructive) — the flat-card language's answer to
 *  ui.tsx's ActionRow. SamRow's own title is always left-aligned next to an optional glyph, so a
 *  standalone "do this" row (Connect to Mac/PC, Disconnect, Pair with Desktop…) needs this
 *  instead. `busy` swaps the label for an inline spinner rather than disabling silently. */
export function SamActionRow({
  title,
  onPress,
  destructive,
  disabled,
  busy,
}: {
  title: string;
  onPress: () => void;
  destructive?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={() => {
        if (disabled || busy) return;
        haptic.light();
        onPress();
      }}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled || !!busy }}
      style={({ pressed }) => ({
        minHeight: samTouch.minTarget,
        borderRadius: samRadius.row,
        backgroundColor: pressed && !disabled ? samColor.raise2 : samColor.raise,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      {busy ? (
        <Spinner reduceMotion={false} />
      ) : (
        <Text style={[samType.rowTitle, { color: destructive ? samColor.red : samColor.accent }]}>{title}</Text>
      )}
    </Pressable>
  );
}

/** Labelled text-input row — the fourteen parts have no field component of their own; samTheme's
 *  `input` token ("text fields, sheet rows") was already reserved for exactly this. */
export function SamField({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry,
  mono,
  accessory,
  ...input
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  /** Machine strings (hosts, codes, keys) compared character-by-character read better fixed-width. */
  mono?: boolean;
  accessory?: ReactNode;
} & Pick<TextInputProps, 'keyboardType' | 'autoCapitalize' | 'autoCorrect' | 'autoComplete' | 'textContentType'>) {
  return (
    <View style={{ borderRadius: samRadius.row, backgroundColor: samColor.input, padding: samSpace.cardPad, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={[samType.monoXs, { color: samInk.metadata }]}>{label.toUpperCase()}</Text>
        {accessory}
      </View>
      <TextInput
        style={[mono ? samType.mono : samType.body, { color: samInk.primary, padding: 0 }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={samInk.metadata}
        secureTextEntry={secureTextEntry}
        accessibilityLabel={label}
        {...input}
      />
    </View>
  );
}
