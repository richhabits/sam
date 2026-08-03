// One query-string reader for every link the app is handed.
//
// Pairing links and quick-action links are parsed by different modules with different rules,
// but they read parameters out of a URL the same way — and that reading is the part that has to
// be careful, because a URL arriving from a widget, a QR code or another app is untrusted input.
// Kept here so there is exactly one copy of it to get right.
//
// Deliberately not `new URL()`: React Native's URL is a partial polyfill whose behaviour has
// differed between engines (Hermes vs JSC) over query parsing and encoding, and a link that
// silently parses differently on one engine is a bug nobody reproduces.

/** Pull a query parameter out of a raw query string. Returns "" when absent, and "" rather than
 *  throwing when the value is malformed percent-encoding — a broken link is not a crash. */
export function param(query: string, name: string): string {
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (decodeURIComponent(pair.slice(0, eq)) !== name) continue;
    try {
      return decodeURIComponent(pair.slice(eq + 1));
    } catch {
      return '';
    }
  }
  return '';
}
