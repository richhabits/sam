// ─────────────────────────────────────────────────────────────
//  S.A.M. · SHEETS — read a CSV and say something USEFUL about it.
//
//  A data dump is not insight. This module parses a delimited file, works out what each
//  column actually IS, and then looks for the things that are wrong with it — duplicate
//  rows, columns that are 90% empty, one column holding two different kinds of value,
//  numbers that sit miles outside the rest. Those findings are the product; the profile
//  table is just the evidence.
//
//  The parser is hand-written on purpose. A CSV parser is a ~60-line state machine and
//  every dependency here is a supply-chain surface plus a build-size cost for something
//  we can hold in our heads. It handles the real-world mess: quoted fields with commas
//  and newlines inside them, "" escapes, CRLF, a UTF-8 BOM, ragged rows, blank lines.
//
//  NOTHING here is unbounded. Bytes, rows, columns and distinct-value tracking are all
//  capped (see CAPS) and every cap that BITES is reported in the output — a truncated
//  answer that doesn't say it was truncated is a lie, and stats over a silently clipped
//  sample are worse than no stats.
//
//  No I/O below readTable(): the parse/profile/render path is pure, so it's testable
//  without touching disk.
// ─────────────────────────────────────────────────────────────

import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";

export const CAPS = {
  /** Most bytes ever read off disk (or accepted inline). Bigger files are read HEAD-first and flagged. */
  maxBytes: 8 * 1024 * 1024,
  /** Most DATA rows kept (header excluded). 50k × ~20 cols of strings is a few hundred MB worst case — enough. */
  maxRows: 50_000,
  /** Most columns kept. Beyond this a "CSV" is almost always a matrix export, and the profile is unreadable anyway. */
  maxCols: 512,
  /** Per column, stop counting distinct values past this. Cardinality is then reported as "≥ n". */
  maxDistinctTracked: 10_000,
  /** How many top values a categorical column shows. */
  topValues: 6,
  /** Below this many rows, no finding is trustworthy — the output says so. */
  smallSample: 20,
} as const;

// ── PARSE ────────────────────────────────────────────────────

export interface ParseResult {
  header: string[];
  rows: string[][];          // padded/truncated to header.length so column indexing is always safe
  delimiter: string;
  /** Rows whose field count didn't match the header. `long` rows had their extra fields DROPPED. */
  ragged: { short: number; long: number };
  truncatedRows: boolean;    // hit CAPS.maxRows
  truncatedCols: boolean;    // hit CAPS.maxCols
  bom: boolean;
  blankLines: number;
}

const DELIM_CANDIDATES = [",", "\t", ";", "|"];

/** Guess the delimiter by counting candidates OUTSIDE quotes in the first few KB. Counting inside
 *  quotes is how sniffers get fooled by an address field full of commas. Comma wins ties — it is
 *  the overwhelmingly common case and a wrong guess degrades to "one big text column", which the
 *  profile then flags rather than hiding. */
export function sniffDelimiter(text: string): string {
  const sample = text.slice(0, 8192);
  const counts = new Map<string, number>(DELIM_CANDIDATES.map((d) => [d, 0]));
  let inQuotes = false;
  for (let i = 0; i < sample.length; i++) {
    const c = sample[i];
    if (c === '"') { inQuotes = !inQuotes; continue; }
    if (inQuotes) continue;
    const n = counts.get(c);
    if (n !== undefined) counts.set(c, n + 1);
  }
  let best = ",", bestN = 0;
  for (const d of DELIM_CANDIDATES) {
    const n = counts.get(d) ?? 0;
    if (n > bestN) { best = d; bestN = n; }
  }
  return bestN > 0 ? best : ",";
}

/** The state machine. Returns raw records — ragged, header not yet split off. */
function splitRecords(text: string, delim: string, maxRecords: number, maxCols: number): { records: string[][]; truncated: boolean; truncatedCols: boolean; blankLines: number } {
  const records: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let truncatedCols = false;
  let blankLines = 0;
  let i = 0;
  const n = text.length;

  const pushField = () => {
    if (row.length < maxCols) row.push(field);
    else truncatedCols = true;
    field = "";
  };
  const pushRow = () => {
    pushField();
    // A single empty field is a blank line, not a row of data. Ambiguous for a genuinely
    // one-column file (blank line vs empty value) — we drop it, because a stray trailing
    // newline is far more common than a meaningful empty single-column row.
    if (row.length === 1 && row[0] === "") blankLines++;
    else records.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }   // "" → a literal quote
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;                                       // commas and newlines are DATA in here
    }
    // A quote only opens a quoted field at the START of a field. Mid-field quotes (he said "hi")
    // are treated as literal characters — strict RFC 4180 would reject the row, and refusing to
    // read a file over one stray quote is worse than reading it the way a human would.
    if (c === '"' && field === "") { inQuotes = true; i++; continue; }
    if (c === delim) { pushField(); i++; continue; }
    if (c === "\r") { i += text[i + 1] === "\n" ? 2 : 1; pushRow(); if (records.length >= maxRecords) return { records, truncated: i < n, truncatedCols, blankLines }; continue; }
    if (c === "\n") { i++; pushRow(); if (records.length >= maxRecords) return { records, truncated: i < n, truncatedCols, blankLines }; continue; }
    field += c; i++;
  }
  if (field !== "" || row.length) pushRow();   // last line with no trailing newline
  return { records, truncated: false, truncatedCols, blankLines };
}

export function parseCsv(input: string, opts: { delimiter?: string; maxRows?: number; maxCols?: number } = {}): ParseResult {
  const maxRows = opts.maxRows ?? CAPS.maxRows;
  const maxCols = opts.maxCols ?? CAPS.maxCols;
  // Strip the UTF-8 BOM. Left in, it welds itself to the first header name ("﻿id") and every
  // lookup of that column silently misses — a genuinely nasty, invisible bug.
  const bom = input.charCodeAt(0) === 0xfeff;
  const text = bom ? input.slice(1) : input;
  const delimiter = opts.delimiter ?? sniffDelimiter(text);

  const { records, truncated, truncatedCols, blankLines } = splitRecords(text, delimiter, maxRows + 1, maxCols);
  if (!records.length) return { header: [], rows: [], delimiter, ragged: { short: 0, long: 0 }, truncatedRows: false, truncatedCols, bom, blankLines };

  const header = records[0].map((h, i) => h.trim() || `column_${i + 1}`);
  const width = header.length;
  const ragged = { short: 0, long: 0 };
  const rows: string[][] = [];
  for (let r = 1; r < records.length; r++) {
    const rec = records[r];
    if (rec.length < width) { ragged.short++; while (rec.length < width) rec.push(""); }
    else if (rec.length > width) { ragged.long++; rec.length = width; }
    rows.push(rec);
  }
  return { header, rows, delimiter, ragged, truncatedRows: truncated, truncatedCols, bom, blankLines };
}

// ── TYPES ────────────────────────────────────────────────────

export type ValueKind = "number" | "date" | "boolean" | "text";
export type ColumnType = ValueKind | "empty";

// Deliberately NOT including "-": it is a legitimate value (a minus sign, a hyphenated code, a
// placeholder in an ID column) far more often than it is a null, and wrongly nulling it would
// invent a data-quality problem that isn't there.
const NULLISH = new Set(["", "null", "nil", "none", "n/a", "na", "#n/a", "nan", "undefined"]);
export const isNullish = (v: string) => NULLISH.has(v.trim().toLowerCase());

// Split deliberately. The spelt-out words are boolean wherever they appear. The single letters are
// NOT, per-value: a column of "x" and "y" (axis labels, sizes, initials) would otherwise be typed
// boolean off the back of one letter. They only count once the WHOLE column is boolean tokens —
// see the retype in columnStats. Found by a smoke test on real-shaped data, which is where it
// would have bitten a user.
const BOOL_WORDS = new Set(["true", "false", "yes", "no"]);
const BOOL_LETTERS = new Set(["y", "n", "t", "f"]);

/** Parse a cell as a number, tolerating the ways spreadsheets dress them up: currency symbols,
 *  a trailing %, thousands separators, and accounting negatives — (1,234.50) is -1234.5.
 *  A percentage keeps its face value (45% → 45); dividing by 100 would silently change every
 *  min/max/mean we report. Thousands separators are only stripped in the strict 1,234,567 shape,
 *  so "1,2" (a European decimal) stays TEXT rather than becoming 12. */
export function toNumber(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let neg = false;
  if (s.length > 2 && s.startsWith("(") && s.endsWith(")")) { neg = true; s = s.slice(1, -1).trim(); }
  s = s.replace(/^[-+]?\s*[£$€¥₹]\s*/, (m) => (m.trim().startsWith("-") ? "-" : m.trim().startsWith("+") ? "+" : ""));
  if (s.endsWith("%")) s = s.slice(0, -1).trim();
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  if (!/^[-+]?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/;
const SLASH_RE = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/;
const NAMED_RE = /^(\d{1,2})[ -]([a-z]{3})[a-z]*[ -](\d{4})$|^([a-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/i;

/** Does this cell LOOK like a date? Shape only — the actual epoch is resolved per column, because
 *  03/04/2024 cannot be read without knowing the column's convention. */
export function looksLikeDate(raw: string): boolean {
  const s = raw.trim();
  if (!s || s.length > 40) return false;
  const iso = ISO_RE.exec(s);
  if (iso) return validYmd(+iso[1], +iso[2], +iso[3]);
  const slash = SLASH_RE.exec(s);
  if (slash) { const a = +slash[1], b = +slash[2]; return a >= 1 && a <= 31 && b >= 1 && b <= 31 && (a <= 12 || b <= 12); }
  return NAMED_RE.test(s);
}
function validYmd(y: number, m: number, d: number): boolean {
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
}

/** Resolve a date cell to epoch ms. `dayFirst` settles the 03/04/2024 ambiguity for the whole
 *  column. Built in UTC so the answer doesn't shift with the machine's timezone. */
export function toDate(raw: string, dayFirst: boolean): number | null {
  const s = raw.trim();
  let m = ISO_RE.exec(s);
  if (m) {
    const [y, mo, d] = [+m[1], +m[2], +m[3]];
    if (!validYmd(y, mo, d)) return null;
    return Date.UTC(y, mo - 1, d, +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
  }
  m = SLASH_RE.exec(s);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    const day = dayFirst ? a : b, mo = dayFirst ? b : a;
    if (!validYmd(y, mo, day)) return null;
    return Date.UTC(y, mo - 1, day);
  }
  m = NAMED_RE.exec(s);
  if (m) {
    if (m[1]) { const mo = MONTHS[m[2].toLowerCase()]; return mo ? Date.UTC(+m[3], mo - 1, +m[1]) : null; }
    const mo = MONTHS[(m[4] ?? "").toLowerCase()];
    return mo ? Date.UTC(+m[6], mo - 1, +m[5]) : null;
  }
  return null;
}

/** What kind of value is this cell, on its own? Order matters: boolean before number so "1"/"0"
 *  stay numeric, and date before number so "2024" alone stays a number (it has no date shape). */
export function inferKind(raw: string): ValueKind {
  const s = raw.trim();
  if (BOOL_WORDS.has(s.toLowerCase())) return "boolean";
  if (looksLikeDate(s)) return "date";
  if (toNumber(s) !== null) return "number";
  return "text";
}
/** Is every distinct value in this column a boolean token, letters included? Only at column level
 *  is "y"/"n" safe to read as a boolean. */
const allBooleanTokens = (distinct: string[]) => distinct.length > 0 && distinct.length <= 4 &&
  distinct.every((v) => { const l = v.toLowerCase(); return BOOL_WORDS.has(l) || BOOL_LETTERS.has(l); });

// ── PROFILE ──────────────────────────────────────────────────

export interface ColumnStats {
  index: number;
  name: string;
  type: ColumnType;
  filled: number;              // non-null cells
  nulls: number;
  fillRate: number;            // 0..1
  cardinality: number;         // distinct non-null values
  cardinalityCapped: boolean;  // hit CAPS.maxDistinctTracked — cardinality is a floor
  top: { value: string; n: number }[];
  kinds: Record<ValueKind, number>;
  mixed: boolean;
  constant: boolean;
  unique: boolean;             // distinct == filled == rows → a candidate key
  padded: number;              // cells with leading/trailing whitespace
  paddedExample?: string;      // the first one, so the finding can show the real offender
  // numeric
  min?: number; max?: number; mean?: number; median?: number; stdev?: number; sum?: number;
  p25?: number; p75?: number;
  outliers?: number[];         // beyond the 1.5·IQR fence, furthest first
  outlierCount?: number;
  // date
  minDate?: string; maxDate?: string;
  dateAmbiguous?: boolean;     // d/m vs m/d could not be settled from the data
}

export interface TableProfile {
  source: string;
  rows: number;
  columns: number;
  delimiter: string;
  cols: ColumnStats[];
  duplicateRows: number;
  duplicateExample?: string;
  ragged: { short: number; long: number };
  blankLines: number;
  bom: boolean;
  truncatedRows: boolean;
  truncatedCols: boolean;
  truncatedBytes: boolean;
  bytesRead: number;
  totalBytes?: number;
  findings: string[];
  caveats: string[];
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function columnStats(name: string, index: number, cells: string[]): ColumnStats {
  const kinds: Record<ValueKind, number> = { number: 0, date: 0, boolean: 0, text: 0 };
  const freq = new Map<string, number>();
  let filled = 0, nulls = 0, padded = 0, capped = false;
  let paddedExample: string | undefined;
  const values: string[] = [];

  for (const raw of cells) {
    if (isNullish(raw)) { nulls++; continue; }
    filled++;
    if (raw !== raw.trim()) { padded++; if (paddedExample === undefined) paddedExample = raw; }
    const v = raw.trim();
    values.push(v);
    kinds[inferKind(v)]++;
    if (freq.size < CAPS.maxDistinctTracked) freq.set(v, (freq.get(v) ?? 0) + 1);
    else if (freq.has(v)) freq.set(v, freq.get(v)! + 1);
    else capped = true;
  }

  // Count descending. Ties keep first-seen order (Map preserves insertion, sort is stable), so the
  // ordering is deterministic AND matches what a human scanning the file top-down would expect.
  const entries = [...freq.entries()].sort((a, b) => b[1] - a[1]);
  const s: ColumnStats = {
    index, name,
    type: "empty",
    filled, nulls,
    fillRate: cells.length ? filled / cells.length : 0,
    cardinality: freq.size,
    cardinalityCapped: capped,
    top: entries.slice(0, CAPS.topValues).map(([value, n]) => ({ value, n })),
    kinds,
    mixed: false,
    constant: filled > 0 && freq.size === 1 && !capped,
    unique: filled > 0 && !capped && freq.size === filled && filled === cells.length,
    padded, paddedExample,
  };
  if (!filled) return s;

  // The column's type is whichever kind dominates. Ties resolve to the most CONSERVATIVE kind
  // (text, then boolean, date, number — first one wins, later kinds need a strictly higher count),
  // because calling a half-and-half column "number" invites a sum that quietly ignores half the
  // data. "Mixed" is the interesting case: a dominant kind under 95% with at least two dissenting
  // values. One stray value in 10,000 is a typo, not a design problem — the threshold keeps the
  // finding meaningful rather than noisy.
  let bestKind: ValueKind = "text", bestN = -1;
  for (const k of ["text", "boolean", "date", "number"] as ValueKind[]) if (kinds[k] > bestN) { bestKind = k; bestN = kinds[k]; }
  const dissent = filled - bestN;
  s.mixed = bestN / filled < 0.95 && dissent >= 2;
  // Column-level boolean: y/n/t/f only become booleans once nothing else is in the column.
  if (bestKind === "text" && !capped && allBooleanTokens([...freq.keys()])) { bestKind = "boolean"; s.mixed = false; }
  s.type = bestKind;

  if (bestKind === "number") {
    const nums = values.map(toNumber).filter((n): n is number => n !== null).sort((a, b) => a - b);
    if (nums.length) {
      const sum = nums.reduce((a, b) => a + b, 0);
      const mean = sum / nums.length;
      s.sum = sum; s.mean = mean;
      s.min = nums[0]; s.max = nums[nums.length - 1];
      s.median = quantile(nums, 0.5);
      s.p25 = quantile(nums, 0.25);
      s.p75 = quantile(nums, 0.75);
      s.stdev = nums.length > 1 ? Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1)) : 0;
      // Tukey's fence rather than a z-score: the mean and stdev are themselves dragged by the
      // outliers we're hunting, so a z-score hides exactly the values it should surface.
      const iqr = s.p75 - s.p25;
      if (iqr > 0) {
        const lo = s.p25 - 1.5 * iqr, hi = s.p75 + 1.5 * iqr;
        const out = nums.filter((n) => n < lo || n > hi).sort((a, b) => Math.abs(b - mean) - Math.abs(a - mean));
        s.outlierCount = out.length;
        s.outliers = out.slice(0, 5);
      } else { s.outlierCount = 0; s.outliers = []; }
    }
  } else if (bestKind === "date") {
    const dates = values.filter(looksLikeDate);
    // Settle d/m vs m/d from the data: any slash date with a first part > 12 proves day-first,
    // any with a second part > 12 proves month-first. No evidence either way → assume day-first
    // (the rest of the world) and SAY it's a guess rather than quietly picking one.
    let dayEvidence = 0, monthEvidence = 0, slashSeen = 0;
    for (const d of dates) {
      const m = SLASH_RE.exec(d);
      if (!m) continue;
      slashSeen++;
      if (+m[1] > 12) dayEvidence++;
      if (+m[2] > 12) monthEvidence++;
    }
    const dayFirst = monthEvidence > dayEvidence ? false : true;
    s.dateAmbiguous = slashSeen > 0 && dayEvidence === 0 && monthEvidence === 0;
    const ts = dates.map((d) => toDate(d, dayFirst)).filter((n): n is number => n !== null);
    if (ts.length) {
      s.minDate = new Date(Math.min(...ts)).toISOString().slice(0, 10);
      s.maxDate = new Date(Math.max(...ts)).toISOString().slice(0, 10);
    }
  }
  return s;
}

/** Turn a parsed table into a profile plus the findings that make it worth reading. Pure. */
export function profileTable(p: ParseResult, meta: { source?: string; bytesRead?: number; totalBytes?: number; truncatedBytes?: boolean } = {}): TableProfile {
  const cols: ColumnStats[] = p.header.map((name, i) => columnStats(name, i, p.rows.map((r) => r[i] ?? "")));

  // Exact duplicate rows. Keyed on the cells joined with NUL — a byte that cannot survive the
  // parser as field content — so ["a,b"] and ["a","b"] cannot collide into a false duplicate.
  const seen = new Set<string>();
  let duplicateRows = 0;
  let duplicateExample: string | undefined;
  for (const r of p.rows) {
    const key = r.join("\u0000");
    if (seen.has(key)) { duplicateRows++; if (!duplicateExample) duplicateExample = r.join(", ").slice(0, 120); }
    else seen.add(key);
  }

  const prof: TableProfile = {
    source: meta.source ?? "the data",
    rows: p.rows.length,
    columns: p.header.length,
    delimiter: p.delimiter,
    cols,
    duplicateRows,
    duplicateExample,
    ragged: p.ragged,
    blankLines: p.blankLines,
    bom: p.bom,
    truncatedRows: p.truncatedRows,
    truncatedCols: p.truncatedCols,
    truncatedBytes: meta.truncatedBytes ?? false,
    bytesRead: meta.bytesRead ?? 0,
    totalBytes: meta.totalBytes,
    findings: [],
    caveats: [],
  };
  prof.findings = findings(prof);
  prof.caveats = caveats(prof);
  return prof;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

function findings(p: TableProfile): string[] {
  const out: string[] = [];
  if (!p.rows) return ["No data rows — the file has a header (or a single line) and nothing under it."];

  if (p.duplicateRows) {
    out.push(`**${p.duplicateRows} duplicate row${p.duplicateRows === 1 ? "" : "s"}** (${pct(p.duplicateRows / p.rows)} of the file) — identical across every column.${p.duplicateExample ? ` First repeat: \`${inlineValue(p.duplicateExample)}\`.` : ""} Worth checking the export didn't run twice before you count anything.`);
  }
  if (p.ragged.short || p.ragged.long) {
    const bits = [p.ragged.short ? `${p.ragged.short} row(s) had FEWER fields than the header (padded with blanks)` : "", p.ragged.long ? `${p.ragged.long} had MORE (the extras were dropped)` : ""].filter(Boolean);
    out.push(`**Ragged rows** — ${bits.join(", ")}. That usually means an unescaped delimiter or a broken line inside a field, so some values are sitting in the wrong column.`);
  }

  const empty = p.cols.filter((c) => c.filled === 0);
  if (empty.length) out.push(`**${empty.length} completely empty column${empty.length === 1 ? "" : "s"}**: ${empty.map((c) => `\`${c.name}\``).join(", ")}. Nothing in them at all — drop them or find out why they stopped being filled.`);

  const sparse = p.cols.filter((c) => c.filled > 0 && c.fillRate < 0.5);
  if (sparse.length) out.push(`**Mostly empty**: ${sparse.map((c) => `\`${c.name}\` (${pct(c.fillRate)} filled)`).join(", ")}. Any average or count over these columns is really an average over the minority that bothered to fill them in.`);

  const mixed = p.cols.filter((c) => c.mixed);
  for (const c of mixed) {
    const mix = (["number", "date", "boolean", "text"] as ValueKind[]).filter((k) => c.kinds[k] > 0).map((k) => `${c.kinds[k]} ${k}`).join(", ");
    out.push(`**\`${c.name}\` holds mixed types** (${mix}). One column, two meanings — a "N/A" typed into a numbers column, or a date format that changed halfway through the export. It will break any sum or sort you do on it.`);
  }

  for (const c of p.cols) {
    if (c.outlierCount && c.outliers?.length) {
      out.push(`**\`${c.name}\` has ${c.outlierCount} outlier${c.outlierCount === 1 ? "" : "s"}** beyond the 1.5×IQR fence (furthest: ${c.outliers.map(fmtNum).join(", ")}), against a median of ${fmtNum(c.median ?? 0)}. Either genuinely extreme cases or a unit/decimal-point error — the mean (${fmtNum(c.mean ?? 0)}) is being dragged by them, so use the median.`);
    }
  }

  const constant = p.cols.filter((c) => c.constant && c.filled === p.rows);
  if (constant.length) out.push(`**No variation** in ${constant.map((c) => `\`${c.name}\` (always "${inlineValue(c.top[0]?.value)}")`).join(", ")} — carries no information for this slice, so it can't explain anything.`);

  const keys = p.cols.filter((c) => c.unique && p.rows > 1);
  if (keys.length) out.push(`Unique in every row: ${keys.map((c) => `\`${c.name}\``).join(", ")} — looks like the identifier${keys.length === 1 ? "" : "s"}, so joins on ${keys.length === 1 ? "it" : "them"} should be safe.`);

  const padded = p.cols.filter((c) => c.padded > 0);
  if (padded.length) {
    const eg = padded.find((c) => c.paddedExample !== undefined);
    out.push(`**Stray whitespace** in ${padded.map((c) => `\`${c.name}\` (${c.padded} cell${c.padded === 1 ? "" : "s"})`).join(", ")}${eg ? ` — e.g. "${eg.paddedExample}" vs "${eg.paddedExample!.trim()}"` : ""}. Those group as two different values until they're trimmed, which quietly splits every count and every join.`);
  }

  const ambiguous = p.cols.filter((c) => c.dateAmbiguous);
  if (ambiguous.length) out.push(`**Ambiguous dates** in ${ambiguous.map((c) => `\`${c.name}\``).join(", ")} — every value fits both DD/MM and MM/DD, so nothing in the file settles which it is. Read as day-first; if the source is American, the date range above is wrong.`);

  return out;
}

function caveats(p: TableProfile): string[] {
  const out: string[] = [];
  if (p.truncatedBytes) out.push(`The file is larger than the ${Math.round(CAPS.maxBytes / 1024 / 1024)} MB read cap${p.totalBytes ? ` (${fmtBytes(p.totalBytes)} total)` : ""} — only the first ${fmtBytes(p.bytesRead)} was read, so every number here describes the TOP of the file, not all of it.`);
  if (p.truncatedRows) out.push(`Stopped at the ${CAPS.maxRows.toLocaleString("en-US")}-row cap — later rows were not read and are not in these stats.`);
  if (p.truncatedCols) out.push(`Stopped at the ${CAPS.maxCols}-column cap — columns beyond that were dropped.`);
  if (p.rows > 0 && p.rows < CAPS.smallSample) out.push(`Only ${p.rows} row${p.rows === 1 ? "" : "s"}. That is too few to conclude anything — treat everything above as a description of these ${p.rows} row${p.rows === 1 ? "" : "s"}, not as a pattern.`);
  for (const c of p.cols) if (c.cardinalityCapped) out.push(`\`${c.name}\` has more than ${CAPS.maxDistinctTracked.toLocaleString("en-US")} distinct values — its count is a floor, not the true total.`);
  return out;
}

// ── RENDER ───────────────────────────────────────────────────

export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  let s: string;
  if (Number.isInteger(n)) s = String(n);
  else if (abs >= 1000) s = n.toFixed(1);
  else if (abs >= 1) s = n.toFixed(2);
  else s = String(Number(n.toPrecision(3)));
  const [whole, frac] = s.split(".");
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac ? `.${frac}` : "");
}
function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
// Escape the BACKSLASH first, then the pipe. The other order takes a cell that already contains
// `\|` and produces `\\|` — an escaped backslash followed by a LIVE pipe, which ends the cell
// early and shunts the rest of the row into the wrong column. Every value here comes out of
// someone's spreadsheet, so it is exactly the kind of thing a real export contains.
// \r as well as \n: a CSV written on Windows carries CR, and a bare CR inside a table row breaks
// the row as completely as a newline does.
const cell = (s: string) => s.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
const clipStr = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// A value going into PROSE rather than a table cell. Same hazard, different shape: a CR or LF
// out of a quoted CSV field breaks the markdown line it is embedded in, and a backtick closes
// the surrounding code span early so the rest of the finding renders as code. cell() cannot be
// reused here — it escapes pipes for a table, which is meaningless in a sentence.
const inlineValue = (s: unknown, n = 40) =>
  clipStr(String(s ?? "").replace(/[\r\n]+/g, " ").replace(/`/g, "'"), n);

function summaryOf(c: ColumnStats): string {
  if (!c.filled) return "—";
  if (c.type === "number") return `${fmtNum(c.min ?? 0)} → ${fmtNum(c.max ?? 0)} · mean ${fmtNum(c.mean ?? 0)} · median ${fmtNum(c.median ?? 0)}`;
  if (c.type === "date") return c.minDate ? `${c.minDate} → ${c.maxDate}` : "unparsed dates";
  if (c.type === "boolean") return c.top.map((t) => `${t.value} ${t.n}`).join(" · ");
  const top = c.top.slice(0, 3).map((t) => `${clipStr(t.value, 18)} (${t.n})`).join(", ");
  return top || "—";
}

/** The chat-facing report. Profile table first (the evidence), findings in prose (the point),
 *  caveats last so they're the final thing read before anyone acts on it. */
export function renderReport(p: TableProfile, opts: { question?: string } = {}): string {
  const lines: string[] = [];
  lines.push(`## ${p.source} — ${fmtNum(p.rows)} row${p.rows === 1 ? "" : "s"} × ${p.columns} column${p.columns === 1 ? "" : "s"}`);
  const delimName = p.delimiter === "\t" ? "tab" : p.delimiter === ";" ? "semicolon" : p.delimiter === "|" ? "pipe" : "comma";
  const bits = [`${delimName}-separated`];
  if (p.bom) bits.push("BOM stripped");
  if (p.blankLines) bits.push(`${p.blankLines} blank line${p.blankLines === 1 ? "" : "s"} skipped`);
  if (p.bytesRead) bits.push(fmtBytes(p.bytesRead));
  lines.push(`*${bits.join(" · ")}*`, "");

  if (p.columns) {
    lines.push("| column | type | filled | distinct | summary |", "|---|---|---|---|---|");
    for (const c of p.cols) {
      const distinct = `${c.cardinalityCapped ? "≥" : ""}${fmtNum(c.cardinality)}`;
      const type = c.mixed ? `${c.type} ⚠︎mixed` : c.type;
      lines.push(`| ${cell(clipStr(c.name, 28))} | ${type} | ${pct(c.fillRate)} | ${distinct} | ${cell(summaryOf(c))} |`);
    }
    lines.push("");
  }

  // A question can't be ANSWERED here — there's no model in this module. What it can do is point
  // the reader (and SAM's own brain, which reads this string back) at the columns it named.
  if (opts.question) {
    const q = opts.question.toLowerCase();
    const hit = p.cols.filter((c) => c.name.length > 2 && q.includes(c.name.toLowerCase()));
    lines.push(`**Your question:** ${opts.question}`);
    if (hit.length) {
      lines.push("", ...hit.map((c) => `- \`${c.name}\` — ${c.type}, ${c.filled} value${c.filled === 1 ? "" : "s"}, ${c.cardinality} distinct. ${summaryOf(c)}`));
    }
    lines.push("");
  }

  lines.push("### What stands out");
  lines.push(...(p.findings.length ? p.findings.map((f) => `- ${f}`) : ["- Nothing obviously wrong: no duplicate rows, no empty or mixed-type columns, no outliers past the IQR fence."]));

  if (p.caveats.length) {
    lines.push("", "### Read this before you act on it");
    lines.push(...p.caveats.map((c) => `- ${c}`));
  }
  return lines.join("\n");
}

// ── DISK ─────────────────────────────────────────────────────

const TABLE_EXTS = new Set([".csv", ".tsv", ".tab", ".txt", ".psv"]);

export class SheetError extends Error {}

/** Read a delimited file HEAD-first, never more than CAPS.maxBytes.
 *
 *  Path posture matches the rest of SAM's file tools (read_file, ingest): expand ~, resolve, and
 *  read from the local disk the user already owns — SAM is a local, single-user process, and a
 *  path allowlist here would just break "analyse the CSV on my external drive". What IS enforced,
 *  copying ingest.ts: an extension allowlist (so this can't be pointed at a binary or a key file
 *  and asked to render it), no directories, and a hard byte cap so a 4 GB export can't take the
 *  process down. Truncation is reported, never silent — the last partial row is dropped because a
 *  byte cut lands mid-record and a half-read row would be profiled as a ragged one. */
export async function readTable(pathIn: string): Promise<{ text: string; bytesRead: number; totalBytes: number; truncatedBytes: boolean; path: string }> {
  const path = resolve(String(pathIn ?? "").replace(/^~(?=$|\/)/, homedir()));
  const ext = extname(path).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls" || ext === ".numbers" || ext === ".ods") {
    throw new SheetError(`${ext} is a binary spreadsheet — I can't open it without a parser dependency. Export the sheet as CSV (File → Export / Save As → CSV) and point me at that.`);
  }
  if (!TABLE_EXTS.has(ext)) throw new SheetError(`I only read delimited text (${[...TABLE_EXTS].join(", ")}); ${ext || "that file"} isn't one.`);

  const s = await stat(path);
  if (s.isDirectory()) throw new SheetError("That's a folder, not a file.");
  const totalBytes = s.size;
  if (!totalBytes) throw new SheetError("That file is empty.");

  const want = Math.min(totalBytes, CAPS.maxBytes);
  const fh = await open(path, "r");
  try {
    const buf = Buffer.alloc(want);
    const { bytesRead } = await fh.read(buf, 0, want, 0);
    let text = buf.subarray(0, bytesRead).toString("utf8");
    const truncatedBytes = totalBytes > CAPS.maxBytes;
    if (truncatedBytes) {
      const lastNl = text.lastIndexOf("\n");
      if (lastNl > 0) text = text.slice(0, lastNl);   // drop the row the byte cap cut in half
    }
    return { text, bytesRead, totalBytes, truncatedBytes, path };
  } finally {
    await fh.close();
  }
}

/** Parse → profile in one call, for callers holding the text already (inline CSV, tests). */
export function analyseCsv(text: string, meta: { source?: string; bytesRead?: number; totalBytes?: number; truncatedBytes?: boolean } = {}): TableProfile {
  return profileTable(parseCsv(text), { bytesRead: Buffer.byteLength(text, "utf8"), ...meta });
}
