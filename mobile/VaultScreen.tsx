import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { api } from './lib/api';
import { parseMarkdown } from './lib/markdown';
import { EmptyState, SamRow, SamSectionLabel, SamSheet, ScreenTitle, StatCard } from './samKit';
import { samColor, samFont, samInk, samRadius, samSpace, samType } from './lib/samTheme';

// VAULT — design_handoff_sam_clients/README.md, build order step 6: "read-only Markdown
// browser over existing files." The files are real — server/vault.ts's plain-.md,
// Obsidian-compatible memory (daily notes + one note per project + facts.md), which already
// powered the desktop HUD's graph panel but had no read route for a NOTE'S CONTENT until this
// step added GET /api/vault/note (server/vault.ts's readVaultNote(), server/index.ts). Three
// stats → note rows → note reader → empty state, per the handoff.

type GraphNode = { id: string; group: string };
type VaultStats = { projectNotes: number; dailyNotes: number; path: string };

export default function VaultScreen({ onNeedsPairing }: { onNeedsPairing: () => void }) {
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [notes, setNotes] = useState<GraphNode[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [openNote, setOpenNote] = useState<GraphNode | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, g] = await Promise.all([api('/api/vault/stats'), api('/api/vault/graph')]);
      setStats(s);
      // "link" nodes are a [[wikilink]] target with no file of its own — see readVaultNote()'s
      // comment. Newest-first has no timestamp to sort by here (the graph carries none), so
      // this is simply reversed — buildGraph() appends project notes then daily notes in
      // directory-listing order, which is at least stable across a session.
      const real = ((g?.nodes as GraphNode[]) || []).filter((n) => n.group === 'project' || n.group === 'daily' || n.group === 'memory');
      setNotes(real.reverse());
      setError('');
    } catch (e: any) {
      if (e?.status === 401) return onNeedsPairing();
      setError(e?.message || "Couldn't reach SAM.");
    } finally {
      setLoading(false);
    }
  }, [onNeedsPairing]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={{ flex: 1, backgroundColor: samColor.ground }}>
      <ScrollView contentContainerStyle={{ paddingTop: samSpace.section, paddingBottom: 40 }}>
        <ScreenTitle>Vault</ScreenTitle>
        <View style={{ flexDirection: 'row', gap: samSpace.rowGap, marginHorizontal: samSpace.gutter, marginBottom: samSpace.section }}>
          {/* "0 in the cloud" is the headline the handoff names explicitly — the one honest
              number this screen can print without reading anything, because nothing in the
              vault ever leaves the machine by architecture, not by today's data. */}
          <StatCard value="0" caption="IN THE CLOUD" />
          <StatCard value={String(stats?.projectNotes ?? (loading ? '—' : 0))} caption="PROJECT NOTES" />
          <StatCard value={String(stats?.dailyNotes ?? (loading ? '—' : 0))} caption="DAILY NOTES" />
        </View>

        {loading ? (
          <ActivityIndicator color={samColor.accent} style={{ marginTop: 40 }} />
        ) : error ? (
          <Text style={{ marginHorizontal: samSpace.gutter, color: samInk.support }}>{error}</Text>
        ) : notes.length === 0 ? (
          <EmptyState glyph="▤" title="Nothing written yet" body="Notes appear here the moment SAM logs its first exchange or project." />
        ) : (
          <View>
            <SamSectionLabel>NOTES</SamSectionLabel>
            <View style={{ marginHorizontal: samSpace.gutter, gap: samSpace.rowGap }}>
              {notes.map((n) => (
                <SamRow
                  key={`${n.group}:${n.id}`}
                  glyph={n.group === 'daily' ? '◷' : n.group === 'memory' ? '✦' : '▤'}
                  title={n.id}
                  meta={n.group}
                  onPress={() => setOpenNote(n)}
                />
              ))}
            </View>
          </View>
        )}
      </ScrollView>

      <NoteSheet note={openNote} onClose={() => setOpenNote(null)} onNeedsPairing={onNeedsPairing} />
    </View>
  );
}

function NoteSheet({ note, onClose, onNeedsPairing }: { note: GraphNode | null; onClose: () => void; onNeedsPairing: () => void }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!note) {
      setContent(null);
      setError('');
      return;
    }
    setContent(null);
    setError('');
    api(`/api/vault/note?group=${encodeURIComponent(note.group)}&id=${encodeURIComponent(note.id)}`)
      .then((r: any) => setContent(typeof r?.content === 'string' ? r.content : ''))
      .catch((e: any) => {
        if (e?.status === 401) return onNeedsPairing();
        setError(e?.status === 404 ? "That note's gone." : e?.message || "Couldn't reach SAM.");
      });
  }, [note, onNeedsPairing]);

  return (
    <SamSheet visible={!!note} onClose={onClose}>
      <ScrollView style={{ maxHeight: 520 }} contentContainerStyle={{ paddingHorizontal: samSpace.gutter, paddingBottom: 24 }}>
        <Text style={[samType.h3, { color: samInk.primary, marginBottom: 12 }]}>{note?.id}</Text>
        {error ? (
          <Text style={[samType.body, { color: samInk.support }]}>{error}</Text>
        ) : content === null ? (
          <ActivityIndicator color={samColor.accent} />
        ) : content === '' ? (
          <Text style={[samType.mono, { color: samInk.metadata }]}>(empty)</Text>
        ) : (
          <PlainMarkdown text={content} />
        )}
      </ScrollView>
    </SamSheet>
  );
}

/** "Note reader (plain Markdown)" per the handoff — same parser ChatScreen's Rendered() uses
 *  (lib/markdown.ts), restyled for the vault's own dark tokens rather than ios's. Code fences
 *  render as plain mono blocks; a vault note is daily-log prose and project summaries, not a
 *  place syntax highlighting earns its keep. */
function PlainMarkdown({ text }: { text: string }) {
  return (
    <>
      {parseMarkdown(text).map((b, i) =>
        b.kind === 'codeblock' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: re-derived in full on every render
          <View key={i} style={{ backgroundColor: samColor.input, borderRadius: samRadius.tile, padding: 10, marginBottom: 10 }}>
            <Text style={[samType.mono, { color: samInk.support }]}>{b.text}</Text>
          </View>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: re-derived in full on every render
          <Text key={i} style={[samType.body, { color: samInk.primary, marginBottom: 10 }]}>
            {b.segments.map((seg, j) =>
              seg.kind === 'bold' ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: re-derived in full on every render
                <Text key={j} style={{ fontWeight: '700' }}>
                  {seg.text}
                </Text>
              ) : seg.kind === 'code' ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: re-derived in full on every render
                <Text key={j} style={[samType.monoLg, { fontFamily: samFont.mono, backgroundColor: samColor.input }]}>
                  {seg.text}
                </Text>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: re-derived in full on every render
                <Text key={j}>{seg.text}</Text>
              ),
            )}
          </Text>
        ),
      )}
    </>
  );
}
