import * as SecureStore from 'expo-secure-store';

// THE DEMO — SAM with nobody home.
//
// The Pocket is a client for a SAM running on your own Mac. That is the whole product, and it
// is also a problem the moment somebody opens the app without one: a reviewer, or anyone
// deciding whether this is worth installing, gets a pairing form and no way to see what they
// would be pairing WITH. An app that cannot be used until you install a second app on a
// different machine is indistinguishable, from the outside, from an app that does not work.
//
// So the pairing screen offers a demo. It answers the same four transports the real app uses,
// with fixed data, and it is labelled as a demo on every screen it touches — a banner that
// cannot be dismissed, because a demo mistaken for a connection is worse than no demo at all.
// Nothing here talks to the network, and entering it never touches the Keychain's real token.
//
// The content is deliberately generic — a tea room, a stalled deploy — and never invented
// personal data. It shows what the surfaces DO, not what anyone's SAM actually said.

const DEMO_KEY = 'sam.demo';

// Read synchronously by the transports on every call, so it is mirrored in memory rather than
// awaited: an async check inside api() would make every caller's first render race the flag.
let demo = false;

export function isDemo(): boolean {
  return demo;
}

/** Restore the flag at boot, beside the token read. A failed read means "not in demo", which
 *  is the truthful answer and lands on the pairing screen — the same rule the token uses. */
export async function loadDemo(): Promise<boolean> {
  try {
    demo = (await SecureStore.getItemAsync(DEMO_KEY)) === '1';
  } catch {
    demo = false;
  }
  return demo;
}

export async function enterDemo(): Promise<void> {
  demo = true;
  try { await SecureStore.setItemAsync(DEMO_KEY, '1'); } catch { /* memory-only is still a demo */ }
}

export async function leaveDemo(): Promise<void> {
  demo = false;
  try { await SecureStore.deleteItemAsync(DEMO_KEY); } catch { /* the flag above is what gates */ }
}

// ── What the demo knows ──────────────────────────────────────────────────────

const HOUR = 3_600_000;
// Fixed offsets from "now" so the list always reads as recent without inventing dates that
// drift into the future or sit suspiciously at midnight.
const ago = (h: number) => Date.now() - h * HOUR;

const JOBS = [
  {
    id: 'demo_job_teahouse',
    kind: 'project.loop',
    payload: { name: 'Teahouse', slug: 'teahouse', what: 'warm up the copy and pull the hours into their own file' },
    state: 'done' as const,
    createdAt: ago(2),
    startedAt: ago(2),
    finishedAt: ago(2) + 134_000,
    // Deliberately repetitive: the same file read several times, which is exactly what the
    // fold's de-duplication is for. Rendered, this reads "Read 3 files · Edited 2 files".
    steps: [
      { label: 'Read content/home.md', state: 'done' as const, at: ago(2) },
      { label: 'Read content/home.md', state: 'done' as const, at: ago(2) },
      { label: 'Read content/hours.md', state: 'done' as const, at: ago(2) },
      { label: 'Read layouts/index.html', state: 'done' as const, at: ago(2) },
      { label: 'Edited content/home.md', state: 'done' as const, at: ago(2) },
      { label: 'Edited content/hours.md', state: 'done' as const, at: ago(2) },
    ],
    costTokens: 1_840,
    project: 'teahouse',
    lastError: null,
  },
  {
    id: 'demo_job_invoices',
    kind: 'notebook.summarise',
    payload: { name: 'Invoices', what: 'summarise this quarter and flag anything unpaid' },
    state: 'done' as const,
    createdAt: ago(6),
    startedAt: ago(6),
    finishedAt: ago(6) + 41_000,
    steps: [
      { label: 'Read invoices/q3.csv', state: 'done' as const, at: ago(6) },
      { label: 'Ran the totals', state: 'done' as const, at: ago(6) },
    ],
    costTokens: 920,
    project: null,
    lastError: null,
  },
  {
    id: 'demo_job_deploy',
    kind: 'project.deploy',
    payload: { name: 'Teahouse', slug: 'teahouse', what: 'put the new page live' },
    state: 'failed' as const,
    createdAt: ago(9),
    startedAt: ago(9),
    finishedAt: ago(9) + 22_000,
    steps: [
      { label: 'Built the site', state: 'done' as const, at: ago(9) },
      { label: 'Upload to the host', state: 'failed' as const, at: ago(9), error: 'the host refused the token' },
    ],
    costTokens: 310,
    project: 'teahouse',
    lastError: 'the build passed but the host refused the upload — check the token',
  },
  {
    id: 'demo_job_watch',
    kind: 'standing.watch',
    payload: { name: 'Watch the inbox', what: 'tell me when anything from the accountant arrives' },
    state: 'running' as const,
    createdAt: ago(0.3),
    startedAt: ago(0.3),
    finishedAt: null,
    steps: [
      { label: 'Connect to the inbox', state: 'done' as const, at: ago(0.3) },
      { label: 'Watch for new mail', state: 'running' as const, at: ago(0.3) },
    ],
    costTokens: 40,
    project: null,
    lastError: null,
  },
];

const YARD = {
  on: true,
  queued: 0,
  running: 1,
  done: 2,
  failed: 1,
  cancelled: 0,
  recent: JOBS,
  meter: { todayTokens: 3_110, weekTokens: 18_400 },
};

const JOB_LOG: Record<string, string[]> = {
  demo_job_teahouse: [
    'claimed project.loop (attempt 1)',
    'checkpointed first: 8fbca82c',
    'check failed (exit 1)',
    'proposal from ollama:qwen2.5-coder:7b',
    '1 file · +4 −4 · warmed the copy and moved the hours out',
    'npm run test passed',
    'checkpoint 46bffd13',
    'done: built and verified after 1 fix · 1 file · +4 −4',
  ],
  demo_job_deploy: [
    'claimed project.deploy (attempt 1)',
    'build passed',
    'upload refused (401) — the host did not accept the token',
    'failed: nothing was published, the last live version is untouched',
  ],
};

const DEVICES = [
  { id: 'demo_device_phone', label: 'iPhone · this device', lastSeen: Date.now() },
  { id: 'demo_device_mac', label: 'Mac · SAM', lastSeen: ago(0.1) },
];

const CONNECTORS = {
  connectors: [
    { id: 'notion', name: 'Notion', connected: false },
    { id: 'slack', name: 'Slack', connected: false },
    { id: 'linear', name: 'Linear', connected: false },
  ],
};

/** The JSON half of the demo — answers the paths api() is asked for, and says so plainly when
 *  asked for one it has no answer to, rather than returning an empty object that renders as a
 *  broken screen. */
export function demoApi(path: string): any {
  if (path.startsWith('/api/yard/job/')) {
    const id = decodeURIComponent(path.slice('/api/yard/job/'.length));
    const job = JOBS.find((j) => j.id === id);
    return job ? { job, log: JOB_LOG[id] ?? ['(no log kept for this one)'] } : { job: null, log: [] };
  }
  if (path.startsWith('/api/yard')) return YARD;
  if (path.startsWith('/api/pair/devices')) return { devices: DEVICES };
  if (path.startsWith('/api/connectors')) return CONNECTORS;
  return { demo: true, note: 'This screen has no demo data.' };
}

// ── The talking half ─────────────────────────────────────────────────────────

// Plurals are the whole game here: the tab is literally called "Tasks", so a pattern that only
// matched "task" sent the most obvious question anyone can ask straight to the fallback. Every
// noun below therefore takes an optional s, and the verbs their common endings.
const ANSWERS: { match: RegExp; text: string }[] = [
  {
    match: /\b(hello|hi|hey|who are you|what are you|what can you do)\b/i,
    text: "I'm SAM — the one running on your own machine. This is a demo, so I'm reading from a fixed script rather than thinking. Pair the app with a Mac running SAM and everything here answers for real, privately, on your hardware.",
  },
  {
    match: /\b(tasks?|jobs?|builds?|deploys?|yard|running|history)\b/i,
    text: 'Have a look at the Tasks tab — it lists what SAM has been doing: a site rebuild that passed, a summary, and a deploy that failed with the reason it failed. Tap one to see its log. In the real thing you can start these from here.',
  },
  {
    match: /\b(privacy|private|data|cloud|secure|security|safe|track\w*)\b/i,
    text: "Nothing leaves your network. SAM runs on your machine, this app pairs to it over your own LAN, and the token that proves the pairing sits in the phone's Keychain. There is no account and no server of ours in between.",
  },
  {
    match: /\b(costs?|prices?|pricing|free|pay|paid|tokens?|subscription)\b/i,
    text: 'Free first, always. SAM prefers a local model on your own machine, then free tiers, and only reaches for anything paid if you explicitly turn it on. The Tasks tab shows what each job actually cost.',
  },
  {
    match: /\b(pair|pairing|connect\w*|set ?up|install)\b/i,
    text: 'Pairing takes one step: open SAM on your Mac, choose "Pair a device", and either tap the link it shows or type the code into this app. No account, no password — the Mac approves this phone once and the token lives in its Keychain.',
  },
];

const FALLBACK =
  "This is a demo, so I'm answering from a short script rather than a model — that's why this reply doesn't really address what you asked. Paired with SAM on your Mac, this same box reaches your own assistant: your files, your notes, your jobs, answered on your own hardware.";

export function demoAnswer(message: string): string {
  return (ANSWERS.find((a) => a.match.test(message)) ?? { text: FALLBACK }).text;
}

/** The streaming half. Deliberately emits token by token on a timer, because the demo exists to
 *  show what using SAM FEELS like, and an answer that lands in one lump does not show that. */
export async function demoStream(
  message: string,
  onToken: (soFar: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const full = demoAnswer(message);
  // Split on whitespace but KEEP it, so the text reassembles exactly rather than losing its
  // spacing — the accumulator is what gets rendered.
  const pieces = full.split(/(\s+)/);
  let soFar = '';
  for (const piece of pieces) {
    if (signal?.aborted) return soFar;
    soFar += piece;
    onToken(soFar);
    // Long enough to read as typing, short enough that nobody waits for the end.
    await new Promise((r) => setTimeout(r, piece.trim() ? 28 : 6));
  }
  return full;
}
