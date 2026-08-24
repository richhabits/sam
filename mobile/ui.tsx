import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  type StyleProp,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { type IOS, metrics, type } from './lib/ios';

// The four native primitives every screen here is built from. Written once so a row in
// Settings and a row in the + sheet are the SAME row — inconsistency between hand-built
// screens is most of what "messy" actually means.

/** A grouped-list screen: system grouped background, 16pt margins, large title at the top. */
export function Screen({
  ios,
  title,
  right,
  refreshControl,
  children,
}: {
  ios: IOS;
  title?: string;
  right?: ReactNode;
  /** Pull-to-refresh. Lives on Screen because Screen owns the ScrollView — a caller that wants
   *  the gesture cannot reach the scroll view otherwise, which is how a list ends up with a
   *  hand-rolled "Refresh" button instead of the gesture every iOS user already tries. */
  refreshControl?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: ios.groupedBg }}
      contentContainerStyle={{ paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={refreshControl as never}
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
          {/* TWO LINES, NOT ONE.
              Both of these were numberOfLines={1}. A title truncates rarely; a subtitle is
              "Upload to the host — the host refused the token" and truncated at exactly the
              point the sentence starts being useful. At accessibility text sizes it lost
              almost everything. Two lines is still a bounded row — the list stays scannable —
              but the failure now fits, and the row grows with the type instead of clipping it
              because metrics.rowMinHeight is a MINIMUM. */}
          <Text
            style={[type.body, { color: destructive ? ios.destructive : ios.label }]}
            numberOfLines={2}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text style={[type.footnote, { color: ios.secondaryLabel, marginTop: 2 }]} numberOfLines={2}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {value ? (
          // flexShrink so a long value yields to the title rather than pushing it out of the
          // row; at AX sizes "18400 tokens" would otherwise take the whole width.
          <Text
            style={[type.body, { color: ios.secondaryLabel, marginLeft: 8, flexShrink: 1 }]}
            numberOfLines={1}
          >
            {value}
          </Text>
        ) : null}
        {accessory}
        {chevron ? (
          <Text style={[type.body, { color: ios.tertiaryLabel, marginLeft: 6 }]} accessible={false}>
            ›
          </Text>
        ) : null}
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
  // A row that navigates IS a button, and until now VoiceOver announced it as plain text with a
  // "›" on the end. The value and subtitle are folded into the label because a row is one idea
  // — "Today, 3110 tokens" — not three separate stops for a swipe.
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={[title, value, subtitle].filter(Boolean).join(', ')}
    >
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
}

/**
 * A text field that lives INSIDE a grouped section, the way Settings.app edits a value: a
 * leading label in the row's own type, the field filling the rest, the same 44pt floor and
 * hairline as every other row. Not a bordered box on a page — a bordered input with its own
 * radius and its own background is the single loudest "this is a web form" tell there is, and
 * it is what the pairing screen used to be built from.
 */
export function Field({
  ios,
  label,
  value,
  onChangeText,
  placeholder,
  mono,
  accessory,
  last,
  ...input
}: {
  ios: IOS;
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  accessory?: ReactNode;
  last?: boolean;
} & Pick<TextInputProps, 'keyboardType' | 'autoCapitalize' | 'autoCorrect' | 'autoComplete' | 'textContentType'>) {
  return (
    <View>
      <View style={s.row}>
        {/* minWidth so the labels still line up, but a long word at AX sizes is allowed to
            take the room it needs instead of truncating to "Addr…". */}
        <Text style={[type.body, { color: ios.label, minWidth: 96, flexShrink: 0 }]} numberOfLines={1}>
          {label}
        </Text>
        <TextInput
          style={[
            type.body,
            { flex: 1, color: ios.label, padding: 0 },
            // Monospace only where the content is a machine string being compared character by
            // character against a screen across the room.
            mono && { fontFamily: 'Menlo', fontSize: 15, letterSpacing: 0.5 },
          ]}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={ios.tertiaryLabel}
          accessibilityLabel={label}
          {...input}
        />
        {accessory ? <View style={{ marginLeft: 8 }}>{accessory}</View> : null}
      </View>
      {!last ? (
        <View
          style={{
            height: metrics.hairline,
            backgroundColor: ios.separator,
            marginLeft: metrics.separatorInset,
          }}
        />
      ) : null}
    </View>
  );
}

/**
 * The centred, tinted row Settings.app uses for the one thing a section is FOR — "Sign Out",
 * "Erase All Content". It is a row, not a button: no fill, no radius of its own, no shadow. The
 * section around it already supplies the shape, which is why native forms never accumulate the
 * stack of rounded rectangles a web form does.
 */
export function ActionRow({
  ios,
  title,
  onPress,
  disabled,
  destructive,
  busy,
  last,
}: {
  ios: IOS;
  title: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  busy?: boolean;
  last?: boolean;
}) {
  const tone = disabled ? ios.tertiaryLabel : destructive ? ios.destructiveText : ios.tintText;
  const body = (pressed: boolean) => (
    <View style={{ backgroundColor: pressed && !disabled ? ios.cardPressed : 'transparent' }}>
      <View style={[s.row, { justifyContent: 'center' }]}>
        {busy ? <ActivityIndicator color={ios.tint} style={{ marginRight: 8 }} /> : null}
        <Text style={[type.body, { color: tone, fontWeight: '600' }]}>{title}</Text>
      </View>
      {!last ? (
        <View style={{ height: metrics.hairline, backgroundColor: ios.separator, marginLeft: metrics.separatorInset }} />
      ) : null}
    </View>
  );
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
    >
      {({ pressed }) => body(pressed)}
    </Pressable>
  );
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
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: on }}
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

/**
 * A HORIZONTAL FILTER STRIP, WHERE THE COUNT AND THE FILTER ARE THE SAME CONTROL.
 *
 * Distinct from Segmented, which is a mutually-exclusive VIEW switch across a fixed, small set
 * that must all fit on screen at once. This is for an open-ended set that scrolls, where each
 * option also has to report how much is behind it.
 *
 * The pattern is Manus's, and the reason to borrow it is that SAM had the two halves separated:
 * a "Now" section listing Running / Queued / Failed / Done as four dead numbers, and an
 * unfilterable list under it. You could read "Failed 3" and have no way to see which three. A
 * count you cannot act on is a worse version of a count you can.
 *
 * Counts are the CALLER'S problem and must describe what the chip actually reveals — the yard's
 * totals are all-time while the list is the last 20 jobs, so a chip reading "Done 847" that
 * opens 12 rows would be a lie in the one place a number is supposed to be checkable.
 */
export function Chips<T extends string>({
  ios,
  options,
  value,
  onChange,
  label,
}: {
  ios: IOS;
  options: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (k: T) => void;
  /** VoiceOver name for the strip itself, e.g. "Filter tasks". */
  label?: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // Bleed the padding into the scroll content, not the view: inset on the ScrollView itself
      // clips the first and last chip mid-scroll instead of letting them run under the edge.
      contentContainerStyle={{ paddingHorizontal: metrics.margin, gap: 8, paddingVertical: 2 }}
      accessibilityRole="tablist"
      accessibilityLabel={label}
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            // Spoken, not read off the chip: "Failed, 3" beats "Failed 3" run together, and the
            // count is meaningless to a screen reader without the noun attached to it.
            accessibilityLabel={o.count === undefined ? o.label : `${o.label}, ${o.count}`}
            accessibilityState={{ selected: on }}
            style={[s.chip, { backgroundColor: on ? ios.tint : ios.fill }]}
          >
            <Text
              // Chips must not scale without bound — a strip of 17pt chips at the largest
              // accessibility size is a single chip and a horizontal scroll to reach a filter.
              // Capped, not frozen: it still grows, and the list it filters scales normally.
              maxFontSizeMultiplier={1.4}
              style={[type.subhead, { fontWeight: '600', color: on ? ios.onTint : ios.label }]}
            >
              {o.label}
              {o.count === undefined ? '' : ` ${o.count}`}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
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
  // 32pt tall at the default text size and fully rounded, which is the iOS capsule. minHeight
  // rather than height so a chip grows with Dynamic Type instead of clipping its own label.
  chip: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  segTrack: { flexDirection: 'row', borderRadius: 9, padding: 2 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 7 },
});
