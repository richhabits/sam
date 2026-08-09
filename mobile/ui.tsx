import type { ReactNode } from 'react';
import { Pressable, ScrollView, type StyleProp, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { type IOS, metrics, type } from './lib/ios';

// The four native primitives every screen here is built from. Written once so a row in
// Settings and a row in the + sheet are the SAME row — inconsistency between hand-built
// screens is most of what "messy" actually means.

/** A grouped-list screen: system grouped background, 16pt margins, large title at the top. */
export function Screen({
  ios,
  title,
  right,
  children,
}: {
  ios: IOS;
  title?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: ios.groupedBg }}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
    >
      {title ? (
        <View style={s.titleRow}>
          <Text style={[type.largeTitle, { color: ios.label, flex: 1 }]}>{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}

/** An inset grouped section — Settings.app's rounded card, with optional header and footer. */
export function Section({
  ios,
  header,
  footer,
  children,
}: {
  ios: IOS;
  header?: string;
  footer?: string;
  children: ReactNode;
}) {
  return (
    <View style={{ marginTop: 24 }}>
      {header ? (
        <Text
          style={[
            type.footnote,
            { color: ios.secondaryLabel, marginHorizontal: metrics.margin + 4, marginBottom: 7, textTransform: 'uppercase' },
          ]}
        >
          {header}
        </Text>
      ) : null}
      <View
        style={{
          backgroundColor: ios.card,
          borderRadius: metrics.radius,
          marginHorizontal: metrics.margin,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
      {footer ? (
        <Text
          style={[type.footnote, { color: ios.secondaryLabel, marginHorizontal: metrics.margin + 4, marginTop: 7 }]}
        >
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The Settings-app leading tile: one glyph in a rounded square, ahead of a row's text. Lives
 * here rather than in TasksScreen because the same job now shows up in three places — the
 * Tasks list, the opening screen's resume cards and the @ picker — and a build that is a
 * hammer in one of them and nothing in the other two is worse than no glyph at all.
 *
 * Fixed 29pt, so the glyph does NOT scale with Dynamic Type: a growing character in a fixed
 * square clips, and this is decoration for scanning, not information. The title beside it
 * carries the meaning and scales normally. Hidden from VoiceOver for the same reason — "▸"
 * read aloud before every row is noise, and the title already says "Build: mainline".
 */
export const GLYPH_SIZE = 29;
export const GLYPH_GAP = 12;

/** The tile carries no outer margin: two of its three callers are flex containers with a `gap`
 *  of their own, and a baked-in margin would silently double it in those. Row passes the gap. */
export function Glyph({ ios, glyph, style }: { ios: IOS; glyph: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View
      style={[s.glyph, { backgroundColor: ios.fill }, style]}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
    >
      {/* 17pt is what SF Symbols sit at in a 29pt Settings tile. At 15 these marks — which are
          typographic characters, not symbols, and so already sit small in their em box — read
          as lost in the middle of the square. */}
      <Text allowFontScaling={false} style={{ fontSize: 17, color: ios.tintText }}>
        {glyph}
      </Text>
    </View>
  );
}

/**
 * One list row. `last` suppresses the separator; everything else is Apple's geometry —
 * 44pt minimum height, separator inset to the text, chevron only when it navigates.
 */
export function Row({
  ios,
  title,
  subtitle,
  value,
  glyph,
  onPress,
  chevron,
  destructive,
  accessory,
  last,
}: {
  ios: IOS;
  title: string;
  subtitle?: string;
  value?: string;
  glyph?: string;
  onPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  accessory?: ReactNode;
  last?: boolean;
}) {
  const body = (pressed: boolean) => (
    <View style={{ backgroundColor: pressed ? ios.cardPressed : 'transparent' }}>
      <View style={s.row}>
        {glyph ? <Glyph ios={ios} glyph={glyph} style={{ marginRight: GLYPH_GAP }} /> : null}
        <View style={{ flex: 1 }}>
          <Text
            style={[type.body, { color: destructive ? ios.destructive : ios.label }]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text style={[type.footnote, { color: ios.secondaryLabel, marginTop: 2 }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {value ? (
          <Text style={[type.body, { color: ios.secondaryLabel, marginLeft: 8 }]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
        {accessory}
        {chevron ? <Text style={[type.body, { color: ios.tertiaryLabel, marginLeft: 6 }]}>›</Text> : null}
      </View>
      {!last ? (
        <View
          style={{
            height: metrics.hairline,
            backgroundColor: ios.separator,
            // Level with the TEXT, which a leading tile pushes right — the separator running
            // under the icon instead of starting after it is the tell of a hand-rolled list.
            marginLeft: glyph ? metrics.margin + GLYPH_SIZE + GLYPH_GAP : metrics.separatorInset,
          }}
        />
      ) : null}
    </View>
  );

  if (!onPress) return body(false);
  return <Pressable onPress={onPress}>{({ pressed }) => body(pressed)}</Pressable>;
}

/** iOS segmented control: a filled track with a raised selected pill. */
export function Segmented<T extends string>({
  ios,
  options,
  value,
  onChange,
}: {
  ios: IOS;
  options: { key: T; label: string }[];
  value: T;
  onChange: (k: T) => void;
}) {
  return (
    <View style={[s.segTrack, { backgroundColor: ios.fill }]}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            style={[
              s.segItem,
              on && {
                backgroundColor: ios.card,
                shadowColor: '#000',
                shadowOpacity: 0.12,
                shadowRadius: 3,
                shadowOffset: { width: 0, height: 1 },
              },
            ]}
          >
            <Text
              style={[
                { fontSize: 13, fontWeight: on ? '600' : '400', color: ios.label },
              ]}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: metrics.margin,
    paddingTop: 8,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: metrics.rowMinHeight,
    paddingHorizontal: metrics.margin,
    paddingVertical: 11,
  },
  glyph: {
    width: GLYPH_SIZE,
    height: GLYPH_SIZE,
    borderRadius: 7, // iOS 26's squircle-ish tile, not a circle and not a hard square
    alignItems: 'center',
    justifyContent: 'center',
  },
  segTrack: { flexDirection: 'row', borderRadius: 9, padding: 2 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 7 },
});
