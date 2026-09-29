import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { api, ApiError } from './lib/api';
import { SamRow, SamSectionLabel } from './samKit';
import { samColor, samInk, samSpace, samType } from './lib/samTheme';

type Holding = { ticker?: string; weight?: number };
type Desk = {
  present?: boolean;
  now?: { equity?: number; status?: string | null; days?: number; target?: number; trades?: number; tradeTarget?: number } | null;
  holdings?: Holding[] | null;
};

// The desk stays on the computer. This screen only reads it. Nothing here can place a trade.
export default function FlipItScreen({
  onClose,
  onOpenPairing,
}: {
  onClose: () => void;
  onOpenPairing: () => void;
}) {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState('');
  const [needsPair, setNeedsPair] = useState(false);

  const load = useCallback(async () => {
    setError('');
    setNeedsPair(false);
    try {
      setDesk(await api('/api/flipit'));
    } catch (e: unknown) {
      const err = e as ApiError;
      if (err?.status === 401) {
        setNeedsPair(true);
        setError('Pair this phone with the computer that runs the desk.');
        return;
      }
      setError(err?.message || 'Could not read the desk.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const now = desk?.now;
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: samColor.ground }}
      contentContainerStyle={{ padding: samSpace.gutter, paddingBottom: 48, gap: samSpace.section }}
    >
      <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to home">
        <Text style={[samType.body, { color: samColor.accent }]}>Home</Text>
      </Pressable>
      <Text style={[samType.h2, { color: samInk.primary }]}>FlipIt</Text>
      {!desk && !error ? <ActivityIndicator color={samColor.accent} /> : null}
      {error ? <Text style={[samType.body, { color: samColor.amber }]}>{error}</Text> : null}
      {needsPair ? (
        <Pressable onPress={onOpenPairing} accessibilityRole="button" accessibilityLabel="Connect to Mac">
          <Text style={[samType.h3, { color: samColor.accent }]}>Connect to Mac / PC</Text>
        </Pressable>
      ) : null}
      {desk && desk.present === false ? (
        <Text style={[samType.body, { color: samInk.support }]}>
          This computer has no FlipIt desk yet. The phone can read one once it is there. It still cannot place a trade.
        </Text>
      ) : null}
      {now ? (
        <View style={{ gap: samSpace.rowGap }}>
          <Text style={[samType.display, { color: samInk.primary, fontSize: 40 }]}>{formatEquity(now.equity)}</Text>
          <Text style={[samType.body, { color: samInk.support }]}>{now.status || 'No status'}</Text>
          <Text style={[samType.mono, { color: samInk.metadata }]}>
            {now.days ?? 0}/{now.target ?? 0} days · {now.trades ?? 0}/{now.tradeTarget ?? 0} trades
          </Text>
        </View>
      ) : null}
      {desk?.holdings?.length ? (
        <View>
          <SamSectionLabel>HOLDINGS</SamSectionLabel>
          <View style={{ marginHorizontal: 0, gap: samSpace.rowGap }}>
            {desk.holdings.map((h) => (
              <SamRow
                key={h.ticker}
                title={h.ticker || '—'}
                meta={h.weight != null ? `${Math.round(h.weight * 100)}%` : undefined}
              />
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}

function formatEquity(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-GB', { maximumFractionDigits: 2 });
}
