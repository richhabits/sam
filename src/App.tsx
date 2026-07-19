import type React from "react";
import { useState, useEffect, useRef, useMemo, lazy, Suspense, memo } from "react";
import { command, confirm as confirmAction, streamCommand, setUser, getProjects, getLog, getStatus, getTools, checkUpdate, runUpdate, getProactive, streamTeam, getAutopilot, setAutopilotMode, setElonMode, importContext, type AgentResult, type Attachment, type Swarm, getSwarms, startSwarm, approveSwarmAgent, addSchedule, getRoster, getMemory, forgetMemory, exportMemory, clearMemory, getQuotes, runArena, getArena, clearArena } from "./lib/api";
import { createPortal } from "react-dom";
import { renderMarkdown } from "./lib/md";
import { startWakeListener } from "./lib/wake";
import { speak as ttsSpeak, stopSpeaking } from "./lib/tts";
import { isStopCommand } from "./lib/stopIntent";
import WidgetRenderer from "./WidgetRenderer";
import ChatList, { displayTitle } from "./ChatList";
import { matchesQuery } from "./lib/chatTitle";
import { ProgressTracker, TraceStrip } from "./components/Trace";
// Heavy panels are lazy-loaded — they only download when you actually open them,
// so the initial app is slimmer and paints faster.
const VoiceMode = lazy(() => import("./VoiceMode"));
const Admin = lazy(() => import("./Admin"));
import UpdateButton from "./UpdateButton";
import Icon, { ICON_NAMES, type IconName } from "./Icon";
import PersonaPicker from "./PersonaPicker";
import { HANDOFF_PROMPT, HANDOFF_BLURB } from "./lib/handoffPrompt";
const Notebook = lazy(() => import("./Notebook"));
const Usage = lazy(() => import("./Usage"));
const KeyWizard = lazy(() => import("./KeyWizard"));
const Dashboard = lazy(() => import("./Dashboard"));
const AutonomyPane = lazy(() => import("./AutonomyPane"));
const LearnedPane = lazy(() => import("./LearnedPane"));
const WorkflowsPane = lazy(() => import("./WorkflowsPane"));
const YourSam = lazy(() => import("./YourSam"));
const DoctorPane = lazy(() => import("./DoctorPane"));

interface Profile { name: string; about?: string; language?: string }
// Multiple people can share one SAM — each profile has its OWN memory (server namespaces
// by name). Saved locally so you switch instantly without re-onboarding.
function loadProfiles(): Profile[] { try { return JSON.parse(localStorage.getItem("sam.profiles") || "[]"); } catch { return []; } }
function saveProfiles(list: Profile[]) { try { localStorage.setItem("sam.profiles", JSON.stringify(list.slice(0, 12))); } catch { /* storage full, disabled or corrupt — fall back to the in-memory default */ } }
const LANGUAGES = ["English", "Español", "Français", "Deutsch", "Italiano", "Português", "Nederlands", "Polski", "Türkçe", "العربية", "हिन्दी", "中文", "日本語", "한국어", "Русский"];
function loadProfile(): Profile { try { return JSON.parse(localStorage.getItem("sam.profile") || "{}"); } catch { return { name: "" }; } }
const TIPS = [
  "💡 Try /team <big request> — SAM assembles a crew of specialists.",
  "🥷 Try /ninjas <problem> — a squad finds and fixes it.",
  "📸 Click 👁️ Look to let SAM see through your camera.",
  "🎙 Hit Voice to go hands-free — talk and listen.",
  "🛡️ Guardian mode watches your camera and flags strangers.",
  "⌨️ ⌘⇧T opens Team, ⌘⇧N opens Ninjas — power user moves.",
  "🔒 Type /private to go fully local — nothing leaves your Mac.",
  "📣 Type /share to copy your SAM pitch + link.",
  "✈️ Turn on Autopilot in settings — SAM handles routine stuff silently.",
];
function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : h < 21 ? "Good evening" : "Late night";
  return name ? `${part}, ${name} 👋` : "Hi there 👋";
}
function randomTip() { return TIPS[Math.floor(Math.random() * TIPS.length)]; }

interface Msg { role: "user" | "sam"; text: string; how?: string; trace?: string[]; at?: string; pinned?: boolean; noBrain?: boolean }
// `title` is auto-derived from the first message on every turn; `name` is a user-set
// override that survives it. `pinned` floats a chat to the top of the sidebar.
interface Convo { id: string; title: string; messages: Msg[]; at: number; folder?: string; name?: string; pinned?: boolean }

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Render a trace line with any URLs as clickable source links.
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const titleOf = (msgs: Msg[]) => {
  const first = msgs.find((m) => m.role === "user")?.text;
  return first ? (first.length > 42 ? first.slice(0, 42) + "…" : first) : "New chat";
};

function howAnswered(provider?: string): string {
  if (!provider) return "";
  if (provider.startsWith("ollama")) return "on your computer";
  if (provider === "none") return "offline";
  if (/claude|anthropic|gpt-4|openai/i.test(provider)) return "on Claude (best)";
  // Free cloud — show WHICH brain answered, so the task-aware routing is visible
  // (quick chat → Cerebras/Groq; reasoning → DeepSeek/NVIDIA; code → DeepSeek/Fireworks).
  const NAMES: Record<string, string> = {
    cerebras: "Cerebras", groq: "Groq", sambanova: "SambaNova", together: "Together",
    deepseek: "DeepSeek", fireworks: "Fireworks", nvidia: "NVIDIA", mistral: "Mistral",
    gemini: "Gemini", openrouter: "OpenRouter", github: "GitHub Models", zhipu: "Zhipu",
    alibaba: "Qwen", xai: "xAI", cohere: "Cohere", perplexity: "Perplexity", nebius: "Nebius",
    hyperbolic: "Hyperbolic", novita: "Novita", siliconflow: "SiliconFlow", huggingface: "HuggingFace",
  };
  const id = provider.split(":")[0];
  return `on ${NAMES[id] || id} (free)`;
}

const COMMANDS: [string, string][] = [
  ["/team", "🤝 Assemble the crew — big jobs, run in parallel"],
  ["/ninjas", "🥷 Deploy the problem squad — find & deal with it"],
  ["/turbo", "⚡ Fastest"],
  ["/private", "🔒 On your computer (local only)"],
  ["/best", "✨ Best quality"],
  ["/auto", "⚡ Free & capable (default)"],
  ["/tools", "🧰 Everything SAM can do"],
  ["/history", "🕑 Past conversations"],
  ["/export", "📤 Download this chat"],
  ["/share", "📣 Copy the SAM link to share"],
  ["/new", "✏️ Start a new chat"],
  ["/help", "❓ All commands"],
];

const SUGGESTIONS = [
  "/team research 3 competitors and draft me a launch post",
  "/ninjas my to-do list — find what's slipping and sort it",
  "What's on my calendar today, and anything urgent in my emails?",
  "Search the web for the best free tools for small businesses",
  "Draft a friendly reply to a customer asking for a refund",
  "Take a screenshot and tell me what's on my screen",
  "Look through my camera — what do you see?",
  "What's the weather today, and directions to the nearest coffee?",
];

type Quality = "turbo" | "auto" | "private" | "best";
// "turbo" is a signal the server maps to the fastest free provider + a single call (no tools).
const QUALITY_TIER: Record<Quality, string | undefined> = { turbo: "turbo", auto: "free", private: "local", best: "premium" };
// Persona voices (mirrors server PERSONAS) — same brain + shared memory, tone only. Default warm "sam".
const PERSONA_OPTS = [
  { id: "sam", label: "SAM", emoji: "🧠", blurb: "warm & sharp" },
  { id: "pa", label: "PA", emoji: "📋", blurb: "crisp & professional" },
  { id: "coach", label: "Coach", emoji: "🔥", blurb: "direct, all momentum" },
  { id: "gran", label: "Gran", emoji: "🫖", blurb: "warm & caring" },
  { id: "mum", label: "Mum", emoji: "🧡", blurb: "nurturing, on-track" },
  { id: "dad", label: "Dad", emoji: "🧢", blurb: "blunt, tough love" },
  { id: "bestie", label: "Bestie", emoji: "💜", blurb: "playful, hyped up" },
  { id: "mentor", label: "Mentor", emoji: "🧭", blurb: "calm, big-picture" },
];

const LS = "sam.v2";
function loadState(): { convos: Convo[]; activeId: string; brand: string; quality: Quality } {
  try {
    const s = JSON.parse(localStorage.getItem(LS) || "{}");
    if (s.convos?.length) return { brand: "", quality: "auto", ...s };
  } catch { /* best-effort — nothing user-visible depends on this succeeding */ }
  const id = uid();
  return { convos: [{ id, title: "New chat", messages: [], at: Date.now() }], activeId: id, brand: "", quality: "auto" };
}
const MemoizedMessageRow = memo(function MemoizedMessageRow({
  m, i, isExpanded, isCopied, isPinned, isPlaying, isLast,
  onFollowUp, onExpand, onCopy, onTogglePin, onQuote, onTogglePlay, onRegenerate, onEdit, onPowerUp
}: any) {
  return (
    <div className={`row ${m.role}`}>
      <div className="who">{m.role === "sam" ? "SAM" : "You"}{m.at && <span className="at"> · {m.at}</span>}</div>
      {m.trace && m.trace.length > 0 && <TraceStrip steps={m.trace} />}
      {m.text && (m.role === "sam"
        ? (m.text.length > 1600 && !isExpanded
            ? <div className="msg-collapsed"><WidgetRenderer text={m.text} onFollowUp={onFollowUp} /><button type="button" className="show-more" onClick={() => onExpand(i)}>Show more ▾</button></div>
            : <div><WidgetRenderer text={m.text} onFollowUp={onFollowUp} />{m.text.length > 1600 && <button type="button" className="show-less" onClick={() => onExpand(i)}>Show less ▴</button>}</div>)
        : <div className="bubble">{m.text}</div>)}
      {m.noBrain && (
        // Every free brain was busy or none is set up. Turn the dead-end into a one-tap fix rather
        // than leaving the user staring at an apology — this is the moment they're most likely to bounce.
        <div className="nobrain-cta">
          <Icon name="sparkle" />
          <span>All free brains are busy right now. Add your own free key and SAM stops waiting in line.</span>
          <button type="button" className="nobrain-btn" onClick={onPowerUp}>Power up — add a free key</button>
        </div>
      )}
      {m.role === "sam" && m.text && (
        <div className="msg-actions">
          <button type="button" className="mini" onClick={() => onCopy(m.text, i)}>{isCopied ? "Copied ✓" : "Copy"}</button>
          <button type="button" className="mini" onClick={() => onTogglePin(i)}>{isPinned ? "Unpin" : "Pin"}</button>
          <button type="button" className="mini" onClick={() => onQuote(m.text)}>Reply</button>
          <button type="button" className="mini" onClick={() => onTogglePlay(m.text, i)}>{isPlaying ? "Stop" : "Listen"}</button>
          {isLast && <button type="button" className="mini" onClick={onRegenerate}>Regenerate</button>}
          {m.how && <span className="how">answered {m.how}</span>}
        </div>
      )}
      {m.role === "user" && (
        <div className="msg-actions"><button type="button" className="mini" onClick={() => onEdit(i)}>Edit</button></div>
      )}
    </div>
  );
}, (prev: any, next: any) => {
  return prev.m === next.m &&
         prev.isExpanded === next.isExpanded &&
         prev.isCopied === next.isCopied &&
         prev.isPinned === next.isPinned &&
         prev.isPlaying === next.isPlaying &&
         prev.isLast === next.isLast;
});

export default function App() {
  const init = useMemo(loadState, []);   // read persisted state ONCE, not on every render
  const [projects, setProjects] = useState<{ id: string; name: string; themeColor?: string }[]>([]);
  const [, setLog] = useState<{ time: string; msg: string }[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [tools, setTools] = useState<{ name: string; safe: boolean; description: string }[]>([]);

  const [convos, setConvos] = useState<Convo[]>(init.convos);
  const [folders, setFolders] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("sam.folders") || "[]"); } catch { return []; } });
  const [folderFilter, setFolderFilter] = useState("");
  const [dragChat, setDragChat] = useState("");   // id of the chat being dragged into a folder
  useEffect(() => { try { localStorage.setItem("sam.folders", JSON.stringify(folders)); } catch { /* storage full, disabled or corrupt — fall back to the in-memory default */ } }, [folders]);
  function addFolder() { const n = window.prompt("New folder name")?.trim(); if (n && !folders.includes(n)) setFolders((f) => [...f, n]); }
  function moveToFolder(id: string, folder: string) { setConvos((cs) => cs.map((c) => (c.id === id ? { ...c, folder: folder || undefined } : c))); }
  // An empty name clears the override and hands the title back to auto-derivation.
  function renameConvo(id: string, name: string) { setConvos((cs) => cs.map((c) => (c.id === id ? { ...c, name: name.trim() || undefined } : c))); }
  function togglePin(id: string) { setConvos((cs) => cs.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))); }
  function renameFolder(old: string) {
    const n = window.prompt("Rename folder", old)?.trim();
    if (!n || n === old || folders.includes(n)) return;
    setFolders((f) => f.map((x) => (x === old ? n : x)));
    setConvos((cs) => cs.map((c) => (c.folder === old ? { ...c, folder: n } : c)));
    if (folderFilter === old) setFolderFilter(n);
  }
  function deleteFolder(name: string) {
    if (!window.confirm(`Delete folder "${name}"? Its chats stay — just unfiled.`)) return;
    setFolders((f) => f.filter((x) => x !== name));
    setConvos((cs) => cs.map((c) => (c.folder === name ? { ...c, folder: undefined } : c)));
    if (folderFilter === name) setFolderFilter("");
  }
  const [activeId, setActiveId] = useState<string>(init.activeId);
  const [messages, setMessages] = useState<Msg[]>(init.convos.find((c) => c.id === init.activeId)?.messages || []);

  const [brand, setBrand] = useState<string>(init.brand);
  const [mode, setMode] = useState<"business" | "personal">(() => { try { return (localStorage.getItem("sam.mode") as any) || "business"; } catch { return "business"; } });
  // Persona: a switchable VOICE over the ONE shared memory (default warm "sam"). Tone only.
  const [persona, setPersona] = useState<string>(() => { try { return localStorage.getItem("sam.persona") || "sam"; } catch { return "sam"; } });
  const [quality, setQuality] = useState<Quality>(init.quality);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Same treatment as the Control Centre: this was one long scroll (quality, audio, prefs, 9
  // skins, keys, devices, data, tools, help, profiles). Tabs keep each view about a screen.
  const [stab, setStab] = useState<"general" | "audio" | "look" | "data" | "more">("general");
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [mem, setMem] = useState<{ groups: Record<string, { id: string; text: string; ts: number }[]>; count: number; note: string } | null>(null);
  const [memQuery, setMemQuery] = useState("");
  const loadMemory = () => getMemory().then(setMem).catch(() => setMem({ groups: {}, count: 0, note: "" }));
  const [toolsOpen, setToolsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [ctxOpen, setCtxOpen] = useState(false);   // mobile: Context/Quick-actions slide-in drawer
  // ── Markets panel: a keyless live watchlist (Fincept strip-map) ──
  const [marketsOpen, setMarketsOpen] = useState(false);
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("sam.watchlist") || "") || ["AAPL", "MSFT", "NVDA", "BTC-USD", "^GSPC"]; }
    catch { return ["AAPL", "MSFT", "NVDA", "BTC-USD", "^GSPC"]; }
  });
  const [quotes, setQuotes] = useState<any[]>([]);
  const [quotesLoading, setQuotesLoading] = useState(false);
  const [tickerInput, setTickerInput] = useState("");
  const loadQuotes = (list = watchlist) => {
    if (!list.length) { setQuotes([]); return; }
    setQuotesLoading(true);
    // Distinguish "no quotes" from "couldn't reach them" — an empty panel used to mean both.
    getQuotes(list.join(",")).then((r) => setQuotes(r.quotes || [])).catch(() => showToast("Couldn't load quotes just now.")).finally(() => setQuotesLoading(false));
  };
  useEffect(() => { localStorage.setItem("sam.watchlist", JSON.stringify(watchlist)); }, [watchlist]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh markets quotes on open; triggered by marketsOpen
  useEffect(() => { if (marketsOpen) loadQuotes(); }, [marketsOpen]);   // refresh on open
  const addTicker = () => {
    const t = tickerInput.trim().toUpperCase();
    if (!t || watchlist.includes(t)) { setTickerInput(""); return; }
    const next = [...watchlist, t]; setWatchlist(next); setTickerInput(""); loadQuotes(next);
  };
  const removeTicker = (sym: string) => { const next = watchlist.filter((s) => s !== sym); setWatchlist(next); loadQuotes(next); };
  // ── Model Colosseum: Elo leaderboard of SAM's free brains (llm-colosseum strip-map) ──
  const [colosseumOpen, setColosseumOpen] = useState(false);
  const [arena, setArena] = useState<{ leaderboard?: any[]; log?: any[]; error?: string } | null>(null);
  const [arenaLoading, setArenaLoading] = useState(false);
  const [arenaStatus, setArenaStatus] = useState<{ current?: any; stale?: boolean; ageDays?: number } | null>(null);
  const runBenchmark = () => {
    setArenaLoading(true); setArena(null);
    runArena().then((r) => { setArena(r); getArena().then(setArenaStatus).catch(() => {/* background refresh — the next poll retries; a toast here would nag */}); }).catch(() => setArena({ error: "Benchmark failed — try again." })).finally(() => setArenaLoading(false));
  };
  useEffect(() => { if (colosseumOpen) getArena().then(setArenaStatus).catch(() => setArenaStatus(null)); }, [colosseumOpen]);
  // Only clear the panel if the server actually cleared the ranking — otherwise routing is still
  // steered by a champion the UI claims is gone.
  const resetRanking = () => { clearArena().then(() => { setArenaStatus({ current: null }); setArena(null); }).catch(() => showToast("Couldn't reset the ranking — SAM is still using the current champion.")); };
  const [pending, setPending] = useState<AgentResult | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [live, setLive] = useState<{ text: string; trace: string[] } | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [scrollPct, setScrollPct] = useState(0);
  const [listening, setListening] = useState(false);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem("sam.dark") === "1"; } catch { return false; } });
  const [skin, setSkin] = useState(() => { try { return localStorage.getItem("sam.skin") || "aurora"; } catch { return "aurora"; } });
  const [speakReplies, setSpeakReplies] = useState(() => { try { return localStorage.getItem("sam.speak") === "1"; } catch { return false; } });
  const [wakeOn, setWakeOn] = useState(() => { try { return localStorage.getItem("sam.wake") === "1"; } catch { return false; } });
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [profiles, setProfiles] = useState<Profile[]>(loadProfiles);
  // Add/refresh a profile in the saved list (upsert by name).
  function upsertProfile(p: Profile) {
    setProfiles((list) => { const next = [p, ...list.filter((x) => x.name.toLowerCase() !== p.name.toLowerCase())]; saveProfiles(next); return next; });
  }
  function switchTo(p: Profile) { setProfile(p); setUser({ ...p, mode, persona }); newChat(); sysNote(`👋 Switched to ${p.name} — this is ${p.name}'s SAM (own memory & chats).`); }
  const [onboardName, setOnboardName] = useState("");
  const [onboardAbout, setOnboardAbout] = useState("");
  const [onboardLang, setOnboardLang] = useState("English");
  const [onboardKey, setOnboardKey] = useState("");   // OPTIONAL free Groq key — never required
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [voiceMode, setVoiceMode] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminFocus, setAdminFocus] = useState<"phone" | undefined>(undefined);
  const [notebookOpen, setNotebookOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [autonomyOpen, setAutonomyOpen] = useState(false);
  const [learnedOpen, setLearnedOpen] = useState(false);
  const [workflowsOpen, setWorkflowsOpen] = useState(false);
  const [yourSamOpen, setYourSamOpen] = useState(false);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [dashOpen, setDashOpen] = useState(false);
  const [palette, setPalette] = useState(false);
  const [pq, setPq] = useState("");        // palette query
  const [pi, setPi] = useState(0);         // palette highlighted index
  const paletteRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const toggleExpand = (i: number) => setExpanded((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });
  const [convoSearch, setConvoSearch] = useState("");
  const [fontSize, setFontSize] = useState(() => { try { return localStorage.getItem("sam.fontsize") || "normal"; } catch { return "normal"; } });
  const [dragOver, setDragOver] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState("");
  const [findIdx, setFindIdx] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);
  const [toast, setToast] = useState("");
  const showToast = (msg: string) => { setToast(msg); window.setTimeout(() => setToast((t) => (t === msg ? "" : t)), 1900); };
  const [rosterOpen, setRosterOpen] = useState(false);
  const [roster, setRoster] = useState<{ id: string; name: string; emoji: string; modeledOn: string; brief: string }[]>([]);
  const [rosterSearch, setRosterSearch] = useState("");
  // An empty crew list and an unreachable server looked identical here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional trigger set; the excluded value is read, not a dependency
  useEffect(() => { if (rosterOpen && !roster.length) getRoster().then((d) => setRoster(d.crew || d || [])).catch(() => showToast("Couldn't load the crew list.")); }, [rosterOpen]);
  useEffect(() => { try { if (fontSize === "normal") document.documentElement.removeAttribute("data-fontsize"); else document.documentElement.setAttribute("data-fontsize", fontSize); localStorage.setItem("sam.fontsize", fontSize); } catch { /* storage full, disabled or corrupt — fall back to the in-memory default */ } }, [fontSize]);
  const [swarms, setSwarms] = useState<Swarm[]>([]);
  const [playing, setPlaying] = useState<number | null>(null);
  const [team, setTeam] = useState<{ crew: any[]; done: Record<string, string>; active: Record<string, boolean> } | null>(null);
  const [guardian, setGuardian] = useState(false);
  const [stranger, setStranger] = useState<string | null>(null);   // Guardian saw someone new → "remember them" banner
  const [strangerName, setStrangerName] = useState("");
  const [timelapse, setTimelapse] = useState(false);
  const tlStream = useRef<MediaStream | null>(null);
  const tlIv = useRef<ReturnType<typeof setInterval> | null>(null);
  const findStream = useRef<MediaStream | null>(null);
  const findIv = useRef<ReturnType<typeof setInterval> | null>(null);
  const [autopilot, setAutopilot] = useState(false);
  useEffect(() => { getAutopilot().then((a) => setAutopilot(!!a.on)).catch(() => {/* background refresh — the next poll retries; a toast here would nag */}); }, []);
  const [elon, setElon] = useState(false);
  function toggleElon() {
    if (!elon) {
      const ok = window.confirm("⚡ ELON MODE — SAM will act on its own with NO ask-first prompts.\n\n• Deletes go to a 30-day trash bin (recoverable)\n• BUT sent emails/messages/posts/payments are NOT recoverable\n• Catastrophic commands are still blocked\n\nTurn it on?");
      if (!ok) return;
    }
    const n = !elon; setElon(n);
    // Revert on failure: an optimistic toggle that keeps the new position after the server
    // write failed shows a state SAM is not actually in.
    setElonMode(n).catch(() => { setElon(!n); showToast("Couldn't change Elon Mode — SAM didn't save it."); });
    sysNote(n ? "⚡ Elon Mode ON — SAM's off the leash. Deletes are recoverable; outward actions aren't." : "⚡ Elon Mode off — back to ask-first.");
  }
  function openStudio() {
    const sd = (window as any).samDesktop;
    if (sd?.openStudio) sd.openStudio();                              // dedicated Electron window
    else window.open(location.pathname + "?app=studio", "_blank");   // browser tab fallback
  }
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState("");
  const [importFile, setImportFile] = useState("");
  const [importDrag, setImportDrag] = useState(false);
  function readImportFile(file: File | undefined | null) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => { setImportText(String(r.result || "")); setImportFile(`${file.name} · ${Math.round((r.result as string || "").length / 1000)}k chars`); setImportResult(""); };
    r.readAsText(file);
  }
  async function runImport() {
    if (!importText.trim() || importBusy) return;
    setImportBusy(true); setImportResult("");
    try {
      const r = await importContext(profile.name || "there", importText);
      setImportResult(r?.ok ? `✅ Imported ${r.factsSaved ?? 0} durable facts into SAM's memory (from ${r.factsExtracted ?? 0} found).` : `Couldn't import: ${r?.error || "unknown"}`);
      if (r?.ok && (r.factsSaved ?? 0) > 0) { setImportText(""); refreshLog(); }
    } catch (e: any) { setImportResult("Import failed: " + (e?.message || e)); }
    finally { setImportBusy(false); }
  }
  const guardStream = useRef<MediaStream | null>(null);
  const guardIv = useRef<any>(null);
  const guardPrev = useRef<Uint8ClampedArray | null>(null);
  const [update, setUpdate] = useState<{ behind: boolean; current?: string; latest?: string; url?: string } | null>(null);
  const [updating, setUpdating] = useState("");
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const msgEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recRef = useRef<any>(null);
  const sendRef = useRef<(text?: string) => void>(() => { /* placeholder until the first render assigns the real send() */ });   // always the latest send() — memoized rows call through this

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only bootstrap: initial fetches + polling interval setup/teardown
  useEffect(() => {
    getProjects().then(setProjects).catch(() => {/* background refresh — the next poll retries; a toast here would nag */});
    getStatus().then(setStatus).catch(() => setStatus(null));
    getTools().then(setTools).catch(() => {/* background refresh — the next poll retries; a toast here would nag */});
    checkUpdate().then((u) => u.behind && setUpdate(u)).catch(() => {/* background refresh — the next poll retries; a toast here would nag */});
    refreshLog();
    inputRef.current?.focus();
    // SAM reaching out first — morning brief / due nudges appear as messages.
    const showProactive = () => getProactive().then((p) => {
      if (p.items?.length) {
        setMessages((m) => [...m, ...p.items.map((it) => ({ role: "sam" as const, text: it.text, how: it.type === "brief" ? "morning brief" : "nudge", at: now() }))]);
        if ("Notification" in window && Notification.permission === "granted") {
          try { new Notification("SAM", { body: p.items[0].text }); } catch { /* notifications may be denied or unavailable — never block on a nicety */ }
        }
      }
    }).catch(() => {/* best-effort — nothing user-visible depends on this succeeding */});
    showProactive();
    // keep the connection dot honest + check for proactive messages (light: every 3 min)
    const iv = setInterval(() => getStatus().then(setStatus).catch(() => setStatus(null)), 12000);
    const pv = setInterval(showProactive, 180000);
    // Swarm poll: fast (5s) only WHILE a swarm is active; idle → 30s. Was a perpetual
    // 5s fetch + full-App re-render even with zero swarms.
    let swarmStop = false, swarmTimer: any;
    const pollSwarms = async () => {
      if (swarmStop) return;
      let active = false;
      try { const sw = await getSwarms(); setSwarms(sw); active = sw.some((s: Swarm) => s.status === "planning" || s.status === "running" || s.status === "paused"); } catch { /* background poll — the next tick retries */ }
      if (!swarmStop) swarmTimer = setTimeout(pollSwarms, active ? 5000 : 30000);
    };
    pollSwarms();
    return () => { clearInterval(iv); clearInterval(pv); swarmStop = true; clearTimeout(swarmTimer); };
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: auto-scroll on new content; atBottom is read, not a trigger
  useEffect(() => { if (atBottom) msgEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, pending]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: resize the textarea when input changes
  useEffect(() => { const el = inputRef.current; if (!el) return; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }, [input]);

  // keep the active conversation in sync + persist everything
  // biome-ignore lint/correctness/useExhaustiveDependencies: sync the active conversation on messages change; activeId is read, not a trigger
  useEffect(() => {
    setConvos((cs) => cs.map((c) => (c.id === activeId ? { ...c, messages, title: titleOf(messages), at: Date.now() } : c)));
  }, [messages]);
  // Debounced persist — coalesce rapid changes into one stringify+write (was a
  // multi-ms synchronous JSON.stringify of up to 50 convos on every completed turn).
  useEffect(() => {
    const t = setTimeout(() => { try { localStorage.setItem(LS, JSON.stringify({ convos: convos.slice(0, 50), activeId, brand, quality })); } catch { /* storage full, disabled or corrupt — fall back to the in-memory default */ } }, 400);
    return () => clearTimeout(t);
  }, [convos, activeId, brand, quality]);

  // keyboard shortcuts
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-bind global shortcuts on the listed state; stable callbacks intentionally excluded
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "t") { e.preventDefault(); setInput("/team "); inputRef.current?.focus(); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "n") { e.preventDefault(); setInput("/ninjas "); inputRef.current?.focus(); }
      else if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); newChat(); }
      else if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); setPalette((v) => !v); setPq(""); setPi(0); }
      else if (mod && e.key.toLowerCase() === "f" && messages.length > 0) { e.preventDefault(); setFindOpen(true); setFindIdx(0); setTimeout(() => findRef.current?.select(), 30); }
      else if (e.key === "Escape") { if (dragOver) setDragOver(false); else if (palette) setPalette(false); else if (findOpen) { setFindOpen(false); setFindQ(""); } else if (loading) stop(); else { setHistoryOpen(false); setCtxOpen(false); setMarketsOpen(false); setColosseumOpen(false); setMemoryOpen(false); setToolsOpen(false); setSettingsOpen(false); setDashOpen(false); setAdminOpen(false); setUsageOpen(false); setNotebookOpen(false); setAutonomyOpen(false); setLearnedOpen(false); setWorkflowsOpen(false); setYourSamOpen(false); setDoctorOpen(false); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loading, palette, findOpen, messages.length, dragOver]);
  // Safety net so the file-drop overlay can NEVER get stuck open: clear it if the drag ends, drops
  // anywhere, or the window loses focus (covers drags cancelled or dropped outside the app).
  useEffect(() => {
    const clear = () => setDragOver(false);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    window.addEventListener("blur", clear);
    return () => { window.removeEventListener("dragend", clear); window.removeEventListener("drop", clear); window.removeEventListener("blur", clear); };
  }, []);
  useEffect(() => { if (palette) setTimeout(() => paletteRef.current?.focus(), 30); }, [palette]);
  // Matching message indices for ⌘F find-in-chat.
  const findMatches = findQ.trim() ? messages.map((m, i) => (m.text || "").toLowerCase().includes(findQ.toLowerCase()) ? i : -1).filter((i) => i >= 0) : [];
  // biome-ignore lint/correctness/useExhaustiveDependencies: find-scroll triggered by findIdx/findQ/findOpen; findMatches is recomputed each render
  useEffect(() => { if (findOpen && findMatches.length) { const el = document.getElementById(`msg-${findMatches[Math.min(findIdx, findMatches.length - 1)]}`); el?.scrollIntoView({ behavior: "smooth", block: "center" }); } }, [findIdx, findQ, findOpen]);

  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Dark skins carry their own dark ground — so they must also drive the [data-theme=dark] rules
  // (syntax colors, badges), not just the manual Dark toggle.
  useEffect(() => { try { const darkSkin = ["jarvis","ember","stealth","midnight","nord","dracula","aurora"].includes(skin); document.documentElement.setAttribute("data-theme", (dark || darkSkin) ? "dark" : "light"); localStorage.setItem("sam.dark", dark ? "1" : "0"); } catch { /* storage full, disabled or corrupt — fall back to the in-memory default */ } }, [dark, skin]);
  useEffect(() => { try { if (skin === "classic") document.documentElement.removeAttribute("data-skin"); else document.documentElement.setAttribute("data-skin", skin); localStorage.setItem("sam.skin", skin); } catch { /* storage full, disabled or corrupt — fall back to the in-memory default */ } }, [skin]);
  useEffect(() => { try { localStorage.setItem("sam.speak", speakReplies ? "1" : "0"); } catch { /* storage full, disabled or corrupt — fall back to the in-memory default */ } }, [speakReplies]);
  useEffect(() => { setUser({ ...profile, mode, persona }); try { localStorage.setItem("sam.profile", JSON.stringify(profile)); localStorage.setItem("sam.mode", mode); localStorage.setItem("sam.persona", persona); } catch { /* storage full, disabled or corrupt — fall back to the in-memory default */ } }, [profile, mode, persona]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: load learned memory when the drawer opens; triggered by memoryOpen
  useEffect(() => { if (memoryOpen) { loadMemory(); setMemQuery(""); } }, [memoryOpen]);   // load the real learned memory when the drawer opens

  // Hands-free wake: whistle or double-clap opens Voice Mode.
  // biome-ignore lint/correctness/useExhaustiveDependencies: wake-listener lifecycle keyed to wakeOn; stable callbacks intentionally excluded
  useEffect(() => {
    if (!wakeOn) { try { localStorage.setItem("sam.wake", "0"); } catch { /* storage full, disabled or corrupt — fall back to the in-memory default */ }; return; }
    let stop: (() => void) | null = null;
    startWakeListener(() => setVoiceMode(true)).then((s) => (stop = s)).catch(() => {
      setWakeOn(false); showToast("🎤 Couldn't access the mic — turned wake off");
    });
    try { localStorage.setItem("sam.wake", "1"); } catch { /* storage full, disabled or corrupt — fall back to the in-memory default */ }
    return () => { stop?.(); };
  }, [wakeOn]);

  function finishOnboarding() {
    const name = onboardName.trim();
    if (!name) return;
    const p = { name, about: onboardAbout.trim() || undefined, language: onboardLang || "English" };
    setProfile(p); setUser({ ...p, mode, persona }); upsertProfile(p);
    // Optional free Groq key — if pasted, save it silently (SAM still works fine without it).
    // A key pasted during onboarding that silently fails to save is the worst version of this
    // bug: the user believes SAM is set up and it is not. Say so, and keep them moving.
    if (onboardKey.trim()) fetch("/api/admin/keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "groq", keys: onboardKey.trim() }) }).catch(() => showToast("Couldn't save that key — add it later in Settings."));
    // ZERO-SETUP: SAM already works on a free no-key brain (+ local Ollama if present) — no keys,
    // no config. So instead of shoving the keys panel in a brand-new user's face, we greet them and
    // drop them straight into a working chat. Keys are an OPTIONAL speed/ability boost (the 🔑 button
    // up top), never a gate. This is the "it just works" first run.
    setMessages([{
      role: "sam",
      text: `Hey ${name} 👋 I'm **SAM** — your private AI, running **free, right on your computer**. Nothing to set up. Ask me anything, or just tell me what you're working on.\n\n_Want me faster, or photos & voice? Tap **🔑 Add free keys** up top — 2 minutes, still free. But you're good to go right now._`,
      how: "welcome",
      at: now(),
    }]);
  }

  const refreshLog = () => getLog().then(setLog).catch(() => {/* background refresh — the next poll retries; a toast here would nag */});

  // Voice input — cross-platform, browser-native (no install, free).
  function toggleVoice() {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { showToast("🎤 Voice input needs Chrome or Edge"); return; }
    // Toggle OFF — you're always in control: one click stops it.
    if (listening) { try { recRef.current?.stop(); recRef.current?.abort?.(); } catch { /* teardown is idempotent — already stopped is a success, not an error */ } setListening(false); showToast("🎤 Mic off"); return; }
    const rec = new SR(); recRef.current = rec;
    rec.lang = navigator.language || "en-GB"; rec.interimResults = false; rec.maxAlternatives = 1; rec.continuous = false;
    rec.onresult = (e: any) => { const t = e.results[0][0].transcript; setInput((v) => (v ? v + " " : "") + t); inputRef.current?.focus(); };
    rec.onend = () => setListening(false);   // stops after one phrase — never loops on its own
    rec.onerror = (e: any) => {
      setListening(false);
      const err = e?.error;
      // Transient TOASTS, never chat messages — so a blocked mic can't spam the thread.
      if (err === "not-allowed" || err === "service-not-allowed") showToast("🎤 Mic blocked — allow it via the 🔒 icon in the address bar");
      else if (err === "audio-capture") showToast("🎤 No microphone found");
      else if (err === "network") showToast("🎤 Voice needs internet (Chrome transcribes via Google)");
      // "no-speech"/"aborted" are normal — stay silent.
    };
    try { setListening(true); rec.start(); inputRef.current?.focus(); }
    catch { setListening(false); showToast("🎤 Couldn't start the mic — try again"); }
  }
  function speakText(text: string) { ttsSpeak(text); }
  // One button to kill EVERYTHING audio/visual — you're always in control.
  function stopAllAV() {
    try { recRef.current?.stop(); recRef.current?.abort?.(); } catch { /* teardown is idempotent — already stopped is a success, not an error */ }
    setListening(false);
    try { stopSpeaking(); } catch { /* teardown is idempotent — already stopped is a success, not an error */ }
    setPlaying(null);
    setSpeakReplies(false);
    if (wakeOn) setWakeOn(false);
    if (guardian) stopGuardian();
    if (timelapse) stopTimelapse();
    stopFind();
    setVoiceMode(false);
    showToast("🔇 All audio & camera stopped");
  }

  function onScroll() { const el = chatRef.current; if (!el) return; setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80); const max = el.scrollHeight - el.clientHeight; setScrollPct(max > 40 ? Math.min(100, (el.scrollTop / max) * 100) : 0); }

  function handleResult(r: AgentResult) {
    if (r.kind === "pending") { setPending(r); return; }
    setMessages((m) => [...m, { role: "sam", text: r.text || "", how: howAnswered(r.provider), trace: r.trace, at: now(), noBrain: r.provider === "none" }]);
    if (speakReplies && r.text) speakText(r.text);
    refreshLog();
  }

  // 🛡️ Guardian — watches the camera. Free/slim: in-browser motion detection gates the
  // vision call, so SAM only "looks" when something actually moves. Flags people it
  // doesn't recognise (notification + message + speaks it).
  function stopGuardian() {
    if (guardIv.current) { clearInterval(guardIv.current); guardIv.current = null; }
    guardStream.current?.getTracks().forEach((t) => { t.stop(); });
    guardStream.current = null; guardPrev.current = null; setGuardian(false);
  }
  async function toggleGuardian() {
    if (guardian) { stopGuardian(); sysNote("🛡️ Guardian off."); return; }
    try {
      guardStream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      setGuardian(true);
      try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch { /* notifications may be denied or unavailable — never block on a nicety */ }
      sysNote("🛡️ Guardian is watching. It only looks when something moves — I'll flag anyone I don't recognise. (Uses free vision; keep this tab open.)");
      const video = document.createElement("video"); video.srcObject = guardStream.current; video.muted = true; await video.play();
      const small = document.createElement("canvas"); small.width = 32; small.height = 24;
      const big = document.createElement("canvas");
      let busy = false;
      const tick = async () => {
        if (!guardStream.current || busy) return;
        try {
          small.getContext("2d")!.drawImage(video, 0, 0, 32, 24);
          const cur = small.getContext("2d")!.getImageData(0, 0, 32, 24).data;
          let moved = false;
          if (guardPrev.current) {
            let diff = 0; for (let i = 0; i < cur.length; i += 4) diff += Math.abs(cur[i] - guardPrev.current[i]);
            moved = diff / (cur.length / 4) > 12;   // mean brightness change threshold
          }
          guardPrev.current = new Uint8ClampedArray(cur);
          if (!moved) return;                        // nothing moved → no vision call (saves quota)
          busy = true;
          big.width = video.videoWidth || 640; big.height = video.videoHeight || 480;
          big.getContext("2d")!.drawImage(video, 0, 0, big.width, big.height);
          const data = big.toDataURL("image/jpeg", 0.7);
          const r = await command(
            "GUARDIAN CHECK. Is there a PERSON in view? If yes and you do NOT recognise them from the people I know, START your reply with 'ALERT' then describe who/where. If it's someone you know, greet them. If no person, reply only 'clear'.",
            brand || undefined, QUALITY_TIER[quality], undefined, [{ kind: "image", name: "guard.jpg", mime: "image/jpeg", data }]);
          const txt = (r.text || "").trim();
          if (/^alert/i.test(txt)) {
            setMessages((m) => [...m, { role: "sam", text: "🛡️ " + txt, how: "guardian", at: now() }]);
            setStranger(txt.replace(/^alert[:,\s]*/i, "").slice(0, 200));   // offer "remember them" banner
            try { if ("Notification" in window && Notification.permission === "granted") new Notification("🛡️ SAM Guardian", { body: txt.slice(0, 140) }); } catch { /* notifications may be denied or unavailable — never block on a nicety */ }
            if (speakReplies) speakText(txt);
          } else if (txt && !/^clear/i.test(txt)) {
            setMessages((m) => [...m, { role: "sam", text: txt, how: "guardian", at: now() }]);
          }
        } catch { /* background loop: swallowing keeps it alive; the next tick retries */ } finally { busy = false; }
      };
      guardIv.current = setInterval(tick, 4000);   // sample every 4s; vision only fires on motion
    } catch { sysNote("Couldn't start Guardian — allow camera access and try again."); }
  }

  // 📷 Shared one-shot frame capture (all camera abilities go through this).
  async function captureFrame(quality = 0.82): Promise<string | null> {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      const video = document.createElement("video");
      video.srcObject = stream; video.muted = true; await video.play();
      await new Promise((r) => setTimeout(r, 450));   // let the camera expose
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", quality);
      stream.getTracks().forEach((t) => { t.stop(); });
      return data;
    } catch {
      stream?.getTracks().forEach((t) => { t.stop(); });
      sysNote("I couldn't open the camera — allow camera access in your browser and try again.");
      return null;
    }
  }

  // Ask SAM something about a fresh camera frame.
  async function askWithFrame(userLabel: string, prompt: string) {
    if (loading) return;
    const data = await captureFrame();
    if (!data) return;
    setMessages((m) => [...m, { role: "user", text: userLabel, at: now() }]);
    setLoading(true);
    try { handleResult(await command(prompt, brand || undefined, QUALITY_TIER[quality], undefined, [{ kind: "image", name: "camera.jpg", mime: "image/jpeg", data }])); }
    catch { sysNote("Couldn't see through the camera just now — need a Gemini key for vision (Settings → API keys)."); }
    setLoading(false); inputRef.current?.focus();
  }

  // 👁️ SAM looks through the webcam — captures one frame → its vision describes it.
  const lookThroughCamera = () => askWithFrame("👁️ (looking through the camera)", "Look through my webcam — tell me what and who you can see, naturally and warmly.");
  // 🙋 Who's that? — recognise from people SAM knows, or ASK the name and remember them.
  const whoIsThis = () => askWithFrame("🙋 (who's this?)",
    "Look at the person in this camera frame. If you recognise them from the people you know, greet them by name. If NOT, describe their look in one short line and ASK me for their name — when I tell you, use the remember_person tool (with that look description) so you know them forever.");
  // 📄 Scan text — camera as a document/receipt scanner.
  const scanTextFromCamera = () => askWithFrame("📄 (scanning text)",
    "Read ALL text visible in this camera frame (document, receipt, screen, label). Give it back accurately and neatly formatted, then offer to save it as a note.");
  // 🔳 Scan a QR code / barcode — native BarcodeDetector when available, else vision fallback.
  async function scanQR() {
    if (loading) return;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const video = document.createElement("video"); video.srcObject = stream; video.muted = true; await video.play();
      await new Promise((r) => setTimeout(r, 500));
      const BD = (window as any).BarcodeDetector;
      if (BD) {
        const det = new BD();
        for (let t = 0; t < 12; t++) {   // scan a couple of seconds
          const codes = await det.detect(video).catch(() => []);
          if (codes?.length) {
            const val = codes[0].rawValue as string;
            stream.getTracks().forEach((x) => { x.stop(); });
            setMessages((m) => [...m, { role: "user", text: "🔳 (scanned a code)", at: now() }]);
            const isUrl = /^https?:\/\//i.test(val);
            setMessages((m) => [...m, { role: "sam", text: `🔳 Scanned: ${isUrl ? `[${val}](${val})` : "`" + val + "`"}${isUrl ? " — want me to open or summarise it?" : ""}`, how: "camera", at: now() }]);
            return;
          }
          await new Promise((r) => setTimeout(r, 180));
        }
        stream.getTracks().forEach((x) => { x.stop(); });
        sysNote("No code spotted — hold it steady in frame and try again.");
        return;
      }
      // Fallback: capture a frame and let vision read it
      const c = document.createElement("canvas"); c.width = video.videoWidth || 640; c.height = video.videoHeight || 480;
      c.getContext("2d")!.drawImage(video, 0, 0, c.width, c.height);
      const data = c.toDataURL("image/jpeg", 0.85); stream.getTracks().forEach((x) => { x.stop(); });
      askWithFrameData("🔳 (scanning a code)", "Read the QR code or barcode in this image and tell me exactly what it contains (URL, text, etc.).", data);
    } catch { stream?.getTracks().forEach((x) => { x.stop(); }); sysNote("Couldn't open the camera to scan."); }
  }

  // helper: ask with a frame we already captured
  async function askWithFrameData(label: string, prompt: string, data: string) {
    setMessages((m) => [...m, { role: "user", text: label, at: now() }]); setLoading(true);
    try { handleResult(await command(prompt, brand || undefined, QUALITY_TIER[quality], undefined, [{ kind: "image", name: "cam.jpg", mime: "image/jpeg", data }])); }
    catch { sysNote("Couldn't read it just now."); }
    setLoading(false);
  }

  // ⏱️ Timelapse watch — snaps every N sec and only pings you when the scene meaningfully changes.
  function stopTimelapse() { if (tlIv.current) { clearInterval(tlIv.current); tlIv.current = null; } tlStream.current?.getTracks().forEach((t) => { t.stop(); }); tlStream.current = null; setTimelapse(false); }
  async function toggleTimelapse() {
    if (timelapse) { stopTimelapse(); sysNote("⏱️ Timelapse watch off."); return; }
    try {
      tlStream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      setTimelapse(true); sysNote("⏱️ Watching this spot — I'll ping you only when something notable changes (e.g. someone arrives, a delivery lands). Keep this tab open.");
      const video = document.createElement("video"); video.srcObject = tlStream.current; video.muted = true; await video.play();
      const big = document.createElement("canvas"); let busy = false; let last = "";
      tlIv.current = setInterval(async () => {
        if (!tlStream.current || busy) return; busy = true;
        try {
          big.width = video.videoWidth || 640; big.height = video.videoHeight || 480;
          big.getContext("2d")!.drawImage(video, 0, 0, big.width, big.height);
          const data = big.toDataURL("image/jpeg", 0.7);
          const r = await command(`TIMELAPSE WATCH. Previous scene: "${last || "(first look)"}". Describe the scene in one short line. Then, if it's NOTABLY different from the previous (a person/vehicle/object appeared or left, not just lighting), start your reply with 'CHANGE:'. Otherwise start with 'same:'.`, brand || undefined, QUALITY_TIER[quality], undefined, [{ kind: "image", name: "tl.jpg", mime: "image/jpeg", data }]);
          const txt = (r.text || "").trim(); last = txt.replace(/^(change|same):\s*/i, "").slice(0, 120);
          if (/^change/i.test(txt)) {
            const msg = "⏱️ " + txt.replace(/^change:\s*/i, "");
            setMessages((m) => [...m, { role: "sam", text: msg, how: "timelapse", at: now() }]);
            try { if ("Notification" in window && Notification.permission === "granted") new Notification("⏱️ SAM Timelapse", { body: msg.slice(0, 140) }); } catch { /* notifications may be denied or unavailable — never block on a nicety */ }
            if (speakReplies) speakText(msg);
          }
        } catch { /* background loop: swallowing keeps it alive; the next tick retries */ } finally { busy = false; }
      }, 30000);   // every 30s
    } catch { sysNote("Couldn't start Timelapse — allow camera access."); }
  }

  // 🔈 Read aloud — scan text from the camera then SPEAK it (accessibility: menus, mail, labels).
  async function readAloudScan() {
    if (loading) return;
    const data = await captureFrame();
    if (!data) return;
    setMessages((m) => [...m, { role: "user", text: "🔈 (read this aloud)", at: now() }]);
    setLoading(true);
    try {
      const r = await command("Read ALL the text in this image exactly, as continuous natural speech (no markdown, no bullet points) — you're reading it out loud to someone.", brand || undefined, QUALITY_TIER[quality], undefined, [{ kind: "image", name: "read.jpg", mime: "image/jpeg", data }]);
      handleResult(r);
      if (r.text) speakText(r.text);   // always speak this one, even if auto-speak is off
    } catch { sysNote("Couldn't read it just now — need a vision brain (Groq or Gemini key, or Ollama)."); }
    setLoading(false);
  }

  // 🔎 Find it — point the camera and SAM tells you when your object is in view (warmer/colder).
  async function findObject() {
    if (loading || findStream.current) return;
    const target = window.prompt("What should I look for? (e.g. my keys, the remote, a red mug)");
    if (!target?.trim()) return;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      findStream.current = stream;
      sysNote(`🔎 Looking for "${target}" — sweep the camera around slowly. Say stop or close this to end.`);
      const video = document.createElement("video"); video.srcObject = stream; video.muted = true; await video.play();
      const big = document.createElement("canvas"); let busy = false; let found = false; let ticks = 0;
      const iv = setInterval(async () => {
        if (!findStream.current || busy || found || ticks++ > 40) { if (ticks > 40) { clearInterval(iv); stopFind(); sysNote("🔎 Gave it a good look — didn't spot it. Try another angle?"); } return; }
        busy = true;
        try {
          big.width = video.videoWidth || 640; big.height = video.videoHeight || 480;
          big.getContext("2d")!.drawImage(video, 0, 0, big.width, big.height);
          const data = big.toDataURL("image/jpeg", 0.6);
          const r = await command(`OBJECT FIND. I'm looking for: "${target}". Is it visible in this frame? If YES, start with 'FOUND:' then say exactly where (left/right/top, on/under what). If NO but you see something close, start with 'warm:' and a hint. Otherwise start with 'cold:'.`, brand || undefined, QUALITY_TIER[quality], undefined, [{ kind: "image", name: "find.jpg", mime: "image/jpeg", data }]);
          const txt = (r.text || "").trim();
          if (/^found/i.test(txt)) { found = true; clearInterval(iv); stopFind(); const msg = "🔎 " + txt.replace(/^found:\s*/i, "Found it — "); setMessages((m) => [...m, { role: "sam", text: msg, how: "camera", at: now() }]); speakText(msg); }
          else if (/^warm/i.test(txt)) { showToast("🔥 " + txt.replace(/^warm:\s*/i, "").slice(0, 60)); }
        } catch { /* background loop: swallowing keeps it alive; the next tick retries */ } finally { busy = false; }
      }, 2500);
      findIv.current = iv;
    } catch { stream?.getTracks().forEach((t) => { t.stop(); }); findStream.current = null; sysNote("Couldn't open the camera to search."); }
  }
  function stopFind() { if (findIv.current) { clearInterval(findIv.current); findIv.current = null; } findStream.current?.getTracks().forEach((t) => { t.stop(); }); findStream.current = null; }

  // 📸 Take a photo → saved to the vault (local only).
  async function snapPhoto() {
    const data = await captureFrame(0.92);
    if (!data) return;
    try {
      const r = await fetch("/api/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) });
      const d = await r.json();
      if (d.ok) { showToast("📸 Saved"); setMessages((m) => [...m, { role: "sam", text: `📸 Snapped and saved to \`${d.path}\` — ask me to look at it or open the folder any time.`, how: "camera", at: now() }]); }
      else sysNote("Couldn't save the photo: " + (d.error || "unknown"));
    } catch { sysNote("Couldn't save the photo — is SAM's brain running?"); }
  }

  function handleSlash(v: string): boolean {
    const cmd = v.toLowerCase();
    if (cmd === "/new" || cmd === "/clear") { newChat(); return true; }
    if (cmd === "/private") { setQuality("private"); sysNote("Switched to Private — everything runs On your computer."); return true; }
    if (cmd === "/best") { setQuality("best"); sysNote("Switched to Best quality."); return true; }
    if (cmd === "/fast" || cmd === "/auto") { setQuality("auto"); sysNote("Switched to Automatic (free & capable)."); return true; }
    if (cmd === "/turbo") { setQuality("turbo"); sysNote("⚡ Turbo — one fast call on the quickest free brain (no tools). Great for quick chat & drafting."); return true; }
    if (cmd === "/tools") { setToolsOpen(true); return true; }
    if (cmd === "/history") { setHistoryOpen(true); return true; }
    if (cmd === "/export") { exportChat(); return true; }
    if (cmd === "/share") { try { navigator.clipboard.writeText("SAM — a free, private AI with a team of agents that runs on your Mac. https://richhabits.github.io/sam/"); sysNote("📣 Copied the SAM pitch + link — paste it anywhere to share."); } catch { sysNote("Couldn't copy — the link is: https://richhabits.github.io/sam/"); } return true; }
    if (v.toLowerCase().startsWith("/team ")) { runTheTeam(v.slice(6), "team"); return true; }
    if (cmd === "/team") { sysNote("Assemble the crew: /team <a big request> — e.g. /team research my 3 competitors and draft a launch post"); return true; }
    if (v.toLowerCase().startsWith("/ninjas ")) { runTheTeam(v.slice(8), "ninjas"); return true; }
    if (cmd === "/ninjas") { sysNote("Deploy the Ninjas 🥷 at a problem: /ninjas <target> — e.g. /ninjas my hectictv repo, or /ninjas my overdue invoices"); return true; }
    if (v.toLowerCase().startsWith("/swarm ")) { runSwarm(v.slice(7)); return true; }
    if (cmd === "/swarm") { sysNote("Start a persistent background swarm: /swarm <massive goal>"); return true; }
    if (v.toLowerCase().startsWith("/schedule ")) { runSchedule(v.slice(10)); return true; }
    if (cmd === "/schedule") { sysNote("Schedule a recurring task: /schedule <cron> | <command> — e.g. /schedule daily 09:00 | check my email"); return true; }
    if (cmd === "/help") { sysNote("Commands: /team, /ninjas, /swarm, /schedule, /new, /turbo, /private, /best, /auto, /tools, /history, /export. ⌘K new chat, Esc stop."); return true; }
    return false;
  }

  // The Team / The Ninjas — specialists run in parallel, SAM synthesises.
  async function runTheTeam(text?: string, kind: "team" | "ninjas" = "team") {
    const value = (text ?? input).trim();
    if (!value || loading) return;
    setInput(""); setPending(null);
    setMessages((m) => [...m, { role: "user", text: (kind === "ninjas" ? "🥷 " : "🤝 ") + value, at: now() }]);
    setLoading(true); setTeam({ crew: [], done: {}, active: {} });
    try {
      await streamTeam(value, brand || undefined, (e) => {
        if (e.type === "plan") setTeam({ crew: e.plan, done: {}, active: {} });
        else if (e.type === "agent-start") setTeam((t) => (t ? { ...t, active: { ...t.active, [e.id]: true } } : t));
        else if (e.type === "agent-done") setTeam((t) => (t ? { ...t, active: { ...t.active, [e.id]: false }, done: { ...t.done, [e.id]: e.output } } : t));
        else if (e.type === "final") setMessages((m) => [...m, { role: "sam", text: e.text || "", how: kind === "ninjas" ? "the ninjas" : "the team", at: now() }]);
      }, kind);
    } catch { setMessages((m) => [...m, { role: "sam", text: `The ${kind} couldn't assemble just now — try again.`, at: now() }]); }
    setTeam(null); setLoading(false); inputRef.current?.focus();
  }

  // The Continuous Swarm
  async function runSwarm(text: string) {
    const value = text.trim();
    if (!value || loading) return;
    setInput(""); setPending(null);
    setMessages((m) => [...m, { role: "user", text: "🐝 Swarm: " + value, at: now() }]);
    try {
      await startSwarm(value, brand || undefined, QUALITY_TIER[quality] as any);
      sysNote("The Swarm has been dispatched. They will run in the background and pause if they need your approval. Keep an eye on the Swarm panel above.");
      getSwarms().then(setSwarms).catch(() => {/* background refresh — the next poll retries; a toast here would nag */});
    } catch { sysNote("Couldn't start the swarm just now."); }
    inputRef.current?.focus();
  }

  // Scheduled Tasks
  async function runSchedule(text: string) {
    const parts = text.split("|").map(s => s.trim());
    if (parts.length < 2) {
      sysNote("Please provide a schedule and a command, separated by |. Example: /schedule daily 09:00 | check my email");
      return;
    }
    const cron = parts[0];
    const commandText = parts.slice(1).join("|");
    setInput(""); setPending(null);
    setMessages((m) => [...m, { role: "user", text: "⏰ Schedule: " + text, at: now() }]);
    try {
      await addSchedule(commandText, cron);
      sysNote(`Scheduled task added: "${commandText}" (${cron}). See the Dashboard to manage your schedules.`);
    } catch {
      sysNote("Couldn't add the schedule. Make sure SAM is running.");
    }
    inputRef.current?.focus();
  }

  function sysNote(text: string) { setMessages((m) => [...m, { role: "sam", text, at: now() }]); }

  const readFile = (f: File) => new Promise<Attachment>((resolve) => {
    const r = new FileReader();
    const isImg = f.type.startsWith("image/");
    r.onload = () => resolve(isImg
      ? { kind: "image", name: f.name, mime: f.type, data: String(r.result) }
      : { kind: "text", name: f.name, text: String(r.result).slice(0, 20000) });
    if (isImg) r.readAsDataURL(f); else r.readAsText(f);
  });
  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    const added = await Promise.all(Array.from(files).slice(0, 6).map(readFile));
    setAttachments((a) => [...a, ...added].slice(0, 8));
    inputRef.current?.focus();
  }

  async function send(text?: string) {
    const value = (text ?? input).trim();
    const atts = attachments;
    // "Make it stop" — a stop/interrupt utterance ("stop", "shut up", "you're not listening")
    // halts SAM immediately and is NEVER forwarded to the brain (sending it would just add
    // another turn to a runaway/looping reply). Must run BEFORE the `loading` gate so it can
    // interrupt a reply that's already streaming.
    if (value && !atts.length && isStopCommand(value)) {
      const wasBusy = loading || listening || voiceMode || speakReplies || playing != null;
      haltNow();
      setInput("");
      if (wasBusy) sysNote("Okay — stopped. 🤫");
      return;
    }
    if ((!value && !atts.length) || loading) return;
    if (value.startsWith("/") && !atts.length && handleSlash(value)) { setInput(""); return; }
    // Natural persona switch — "be my coach", "SAM be my gran", "switch to PA", "act like my dad".
    if (!atts.length) {
      const pm = value.match(/^\s*(?:sam[,!.\s]*)?(?:be|become|switch to|talk like|act like|go)\s+(?:my\s+)?(sam|pa|coach|gran(?:ny|dma)?|mum|mom|dad|bestie|mentor|assistant)\b/i);
      if (pm) {
        const raw = pm[1].toLowerCase();
        const id = raw.startsWith("gran") ? "gran" : raw === "mom" ? "mum" : raw === "assistant" ? "pa" : raw;
        const p = PERSONA_OPTS.find((x) => x.id === id);
        if (p) { setPersona(id); setInput(""); sysNote(`${p.emoji} You've got it — I'm your ${p.label} now. Same memory, ${p.blurb}.`); return; }
      }
    }
    setInput(""); setPending(null); setAttachments([]);
    const label = value || (atts.length ? `📎 ${atts.map((a) => a.name).join(", ")}` : "");
    // Prior turns → context so "proceed"/"continue"/"1 then 2" know the thread. `messages`
    // here is the state BEFORE this turn's user message is appended just below.
    const history = messages.filter((m) => m.text?.trim()).slice(-10).map((m) => ({ role: m.role, text: m.text }));
    setMessages((m) => [...m, { role: "user", text: label, at: now() }]);
    setLoading(true);
    abortRef.current = new AbortController();

    // Attachments (photos/files) → non-streaming vision/file path.
    if (atts.length) {
      try { handleResult(await command(value || "Have a look at this.", brand || undefined, QUALITY_TIER[quality], abortRef.current.signal, atts, history)); }
      catch { setMessages((m) => [...m, { role: "sam", text: "I couldn't reach my brain just now.", at: now() }]); }
      setLoading(false); abortRef.current = null; return;
    }

    // Normal message → STREAM tokens live.
    setLive({ text: "", trace: [] });
    let produced = false, acc = "";
    const onEvent = (e: any) => {
      if (e.type === "token") { produced = true; acc += e.t; setLive((l) => ({ text: (l?.text || "") + e.t, trace: l?.trace || [] })); }
      else if (e.type === "tool") { produced = true; setLive((l) => ({ text: l?.text || "", trace: [...(l?.trace || []), e.activity] })); }
      else if (e.type === "pending") { produced = true; setLive(null); setPending({ ...e, message: value, projectId: brand || "", tier: QUALITY_TIER[quality] } as AgentResult); }
      else if (e.type === "done") {
        produced = true; setLive(null);
        setMessages((m) => [...m, { role: "sam", text: e.text || "", trace: e.trace, how: howAnswered(e.provider), at: now(), noBrain: e.provider === "none" }]);
        if (speakReplies && e.text) speakText(e.text);
        refreshLog();
      }
    };
    // Seamless: if the brain is still warming up, retry once quietly before erroring.
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await streamCommand(value, brand || undefined, QUALITY_TIER[quality], onEvent, abortRef.current.signal, history); break; }
      catch (err: any) {
        if (err?.name === "AbortError") { setLive(null); break; }
        if (!produced && attempt === 0) { await new Promise((r) => setTimeout(r, 900)); setLive({ text: "", trace: [] }); continue; }
        setLive(null);
        // If a partial answer already streamed, KEEP it rather than throwing it away.
        setMessages((m) => [...m, acc.trim()
          ? { role: "sam" as const, text: acc + "\n\n_(connection dropped mid-reply)_", at: now() }
          : { role: "sam" as const, text: "I couldn't reach my brain — make sure SAM's running, then try again.", at: now() }]);
        break;
      }
    }
    setLoading(false); abortRef.current = null;
    inputRef.current?.focus();
  }

  // Used by hands-free Voice Mode — runs a turn and returns SAM's reply to speak.
  async function voiceAsk(q: string): Promise<string> {
    if (isStopCommand(q)) { haltNow(); return ""; }   // spoken "stop"/"shut up" halts now — never sent to the brain
    if (loading) return "One sec — I'm still finishing the last one.";   // same gate as typed send() — don't interleave turns
    setLoading(true);
    setMessages((m) => [...m, { role: "user", text: q, at: now() }]);
    try {
      const r = await command(q, brand || undefined, QUALITY_TIER[quality]);
      if (r.kind === "pending") { setPending(r); return "I need your OK for that one — I've put it on the screen for you."; }
      setMessages((m) => [...m, { role: "sam", text: r.text || "", how: howAnswered(r.provider), trace: r.trace, at: now(), noBrain: r.provider === "none" }]);
      refreshLog();
      return r.text || "";
    } catch { return "I couldn't reach my brain just then."; }
    finally { setLoading(false); }
  }

  function stop() { abortRef.current?.abort(); setLive(null); setLoading(false); }
  // Instant "make it stop" — abort the reply, stop talking, drop the mic, leave Voice Mode.
  // The escape hatch when a reply runs away or loops. Unlike stopAllAV it does NOT flip your
  // persistent voice/wake preferences off — it just halts what's happening right now.
  function haltNow() {
    try { abortRef.current?.abort(); } catch { /* teardown is idempotent — already stopped is a success, not an error */ }
    abortRef.current = null;
    setLive(null); setLoading(false); setPending(null);
    try { stopSpeaking(); } catch { /* teardown is idempotent — already stopped is a success, not an error */ }
    setPlaying(null);
    try { recRef.current?.stop(); recRef.current?.abort?.(); } catch { /* teardown is idempotent — already stopped is a success, not an error */ }
    setListening(false);
    if (voiceMode) setVoiceMode(false);
  }
  function editResend(i: number) { const m = messages[i]; if (!m) return; setInput(m.text); setMessages((ms) => ms.slice(0, i)); inputRef.current?.focus(); }

  async function decide(approved: boolean, always = false) {
    if (!pending) return;
    const p = pending; setPending(null); setLoading(true);
    try { handleResult(await confirmAction(p, approved, always)); }
    catch { setMessages((m) => [...m, { role: "sam", text: "Something went wrong finishing that action.", at: now() }]); }
    setLoading(false);
  }

  function newChat() {
    const id = uid();
    setConvos((cs) => [{ id, title: "New chat", messages: [], at: Date.now() }, ...cs.filter((c) => c.messages.length > 0)]);
    setActiveId(id); setMessages([]); setPending(null); setInput(""); inputRef.current?.focus();
  }
  function openConvo(id: string) {
    setActiveId(id); setMessages(convos.find((c) => c.id === id)?.messages || []); setPending(null); setHistoryOpen(false);
  }
  function deleteConvo(id: string) {
    // Compute first, then set each state — a setState updater must be pure (React may
    // call it twice in StrictMode/concurrent, which would double-fire the side effects).
    const rest = convos.filter((c) => c.id !== id);
    if (id === activeId) {
      const next = rest[0] || { id: uid(), title: "New chat", messages: [], at: Date.now() };
      setActiveId(next.id); setMessages(next.messages); setConvos(rest.length ? rest : [next]);
    } else {
      setConvos(rest);
    }
  }

  async function copyMsg(text: string, i: number) {
    try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500); } catch { /* clipboard needs permission/focus — the copy button just doesn't confirm */ }
  }
  function exportChat() {
    const md = messages.map((m) => `**${m.role === "sam" ? "SAM" : "You"}**${m.at ? ` (${m.at})` : ""}:\n\n${m.text}`).join("\n\n---\n\n");
    const blob = new Blob([`# SAM chat\n\n${md}\n`], { type: "text/markdown" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `SAM-chat-${new Date().toISOString().slice(0, 10)}.md`; a.click();
  }
  // Quote a message into the composer so you can reply referencing it.
  function quoteReply(text: string) {
    const snip = text.replace(/\s+/g, " ").trim().slice(0, 160);
    setInput((prev) => `> ${snip}${text.length > 160 ? "…" : ""}\n\n${prev}`);
    inputRef.current?.focus();
  }
  // Re-run the last question: drop the trailing SAM reply + the user turn, then re-send it.
  function regenerate() {
    if (loading) return;
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    setMessages((m) => { const c = [...m]; while (c.length && c[c.length - 1].role === "sam") c.pop(); if (c.length && c[c.length - 1].role === "user") c.pop(); return c; });
    setTimeout(() => send(lastUser.text), 30);
  }

  const started = messages.length > 0 || !!pending || loading;

  // First-run onboarding — greets a brand-new user and learns their name,
  // so SAM addresses THEM (great for sharing with a mate).
  if (!profile.name) {
    return (
      <div className="app onboarding">
        <div className="onboard-card">
          <div className="onboard-emoji">👋</div>
          <div className="onboard-title">Hi, I'm SAM.</div>
          <div className="onboard-by">by <b>HECTIC</b></div>
          <div className="onboard-sub">Your own AI assistant — I answer, draft, search the web, and take action on your computer. First up, what should I call you?</div>
          <div className="onboard-pills"><span>🔒 Private</span><span>💸 Free</span><span>🖐️ Takes action</span><span>🎨 Yours</span></div>
          <input className="onboard-input" autoFocus value={onboardName} onChange={(e) => setOnboardName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && onboardName.trim()) finishOnboarding(); }} placeholder="Your name" />
          <input className="onboard-input" value={onboardAbout} onChange={(e) => setOnboardAbout(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && onboardName.trim()) finishOnboarding(); }} placeholder="What do you do? (optional — helps me help you)" />
          <select className="onboard-input" value={onboardLang} onChange={(e) => setOnboardLang(e.target.value)} aria-label="Language">
            {LANGUAGES.map((l) => <option key={l} value={l}>{l === "English" ? "Language: English" : l}</option>)}
          </select>
          <input className="onboard-input" value={onboardKey} onChange={(e) => setOnboardKey(e.target.value)} type="password"
            onKeyDown={(e) => { if (e.key === "Enter" && onboardName.trim()) finishOnboarding(); }}
            placeholder="⚡ Optional: paste a free Groq key for speed — or skip, SAM's free already" />
          <div className="onboard-hint">No key? Skip it — SAM works free out of the box. Want it snappy? <a href="https://console.groq.com/keys" target="_blank" rel="noreferrer">Grab a free Groq key</a> (~30 sec) and paste it above.</div>
          <button type="button" className="onboard-go" onClick={finishOnboarding} disabled={!onboardName.trim()}>Let's go →</button>
          <div className="onboard-note">Then try: <b>"what's the weather and directions to the nearest coffee?"</b> — you'll watch SAM use a real tool. Private &amp; free — runs on your computer.</div>
        </div>
      </div>
    );
  }

  sendRef.current = send;   // keep the ref current so old (memoized) message rows never fire a stale send
  const activeBrand = projects.find((p) => p.id === brand);
  const customAccent = mode === "business" && activeBrand?.themeColor ? activeBrand.themeColor : undefined;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: app-level drag-and-drop dropzone; not a click control
    <div className="app" style={customAccent ? { "--accent": customAccent, "--accent-2": customAccent } as React.CSSProperties : undefined}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); if (!dragOver) setDragOver(true); } }}
      onDragLeave={(e) => { const rt = e.relatedTarget as Node | null; if (!rt || !e.currentTarget.contains(rt)) setDragOver(false); }}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}>
      {dragOver && (
        // biome-ignore lint/a11y/noStaticElementInteractions: dismissible drop overlay; click-anywhere or Esc dismisses
        // biome-ignore lint/a11y/useKeyWithClickEvents: dismissible drop overlay; click-anywhere or Esc dismisses
        <div className="app-drop" onClick={() => setDragOver(false)}><div className="app-drop-card">📎 Drop it anywhere — SAM reads files &amp; photos<span>images · PDFs · docs · code · chat history</span><em>click anywhere or press Esc to dismiss</em></div></div>
      )}
      <header className="bar">
        <div className="brandmark">
          <button type="button" className="icon-btn ghost" onClick={() => setHistoryOpen(true)} title="Chat history (⌘K for new)" aria-label="History">☰</button>
          <span className="dot-live" title={status ? "Connected" : "Starting…"} />
          {/* mobile-only: reach the Context panel (quick actions + status), hidden on desktop where .ctx is always visible */}
          <button type="button" className="icon-btn ghost ctx-toggle" onClick={() => setCtxOpen(true)} title="Quick actions & context" aria-label="Context">◧</button>
          <span className="wordmark">SAM<span className="wm-dot">.</span></span>
          <span className="tag">Smart Artificial Mind</span>
        </div>
        <div className="bar-right">
          {deferredPrompt && <button type="button" className="icon-btn" onClick={() => { deferredPrompt.prompt(); deferredPrompt.userChoice.then(() => setDeferredPrompt(null)); }} title="Install SAM to your Dock">⬇️ Add to Dock</button>}
          {started && <button type="button" className="icon-btn" onClick={newChat} title="New chat (⌘K)">New chat</button>}
          <button type="button" className="icon-btn voice-btn" onClick={() => setVoiceMode(true)} title="Talk to SAM out loud"><Icon name="voice" /> Voice</button>
          <button type="button" className="icon-btn" onClick={openStudio} title="Open SAM Studio — image & video generation"><Icon name="studio" /> Studio</button>
          
          <div className="mode-toggle" role="tablist" title="Business mind at work · Personal mind at home">
            <button type="button" role="tab" className={mode === "business" ? "on" : ""} onClick={() => setMode("business")}><Icon name="briefcase" /> Business</button>
            <button type="button" role="tab" className={mode === "personal" ? "on" : ""} onClick={() => setMode("personal")}><Icon name="home" /> Personal</button>
          </div>
          {/* Persona switcher — same brain + memory, different voice. Warm "SAM" is the default. */}
          <PersonaPicker
            value={persona}
            options={PERSONA_OPTS}
            onPick={(id) => {
              setPersona(id);
              const p = PERSONA_OPTS.find((x) => x.id === id);
              sysNote(`${p?.emoji ?? ""} SAM is now your ${p?.label ?? "SAM"} — same memory, ${p?.blurb ?? ""}.`);
            }}
          />
          {mode === "business" && (
            <label className="biz">
              <span className="biz-label">Brand</span>
              <select value={brand} onChange={(e) => setBrand(e.target.value)}>
                <option value="">All my businesses</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          {(listening || speakReplies || wakeOn || guardian || voiceMode) && (
            <button type="button" className="icon-btn av-stop" onClick={stopAllAV} title="Stop all audio & camera now">🔇 Stop</button>
          )}
          {(() => {
            const n = (status?.models?.providers || []).filter((p: any) => p.tier === "free" && p.keys > 0).length;
            return (
              <button
                type="button"
                className={"key-cta" + (n === 0 ? " needs" : "")}
                // First run (no keys yet) → the 4-brain wizard, which is the gentler on-ramp.
                // Once you HAVE keys, this button reads as "manage my keys", so it must open the
                // full panel: the wizard lists 4 of 43 providers, so anyone hunting for a specific
                // brain (GLM, Kimi) hit a dead end here and had no way through to the real list.
                onClick={() => (n === 0 ? setWizardOpen(true) : setAdminOpen(true))}
                title={n === 0 ? "Add your free AI keys — SAM rotates them so you never hit a limit" : "Manage all API keys & providers"}>
                <Icon name="key" /> {n > 0 ? `${n} free key${n === 1 ? "" : "s"}` : "Add free keys"}
              </button>
            );
          })()}
          <button type="button" className="icon-btn" onClick={() => setDashOpen(true)} title="SAM control centre"><Icon name="chart" /> Dashboard</button>
          <UpdateButton />
          <button type="button" className="icon-btn" onClick={() => setSettingsOpen((v) => !v)} title="Settings" aria-label="Settings">⚙</button>
        </div>
        {settingsOpen && createPortal(<>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: popover scrim; click-outside close, Esc handled elsewhere */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: popover scrim; click-outside close, Esc handled elsewhere */}
          <div className="pop-scrim" onClick={() => setSettingsOpen(false)} />
          <div className="popover" role="menu">
            <div className="pop-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={stab === "general"} className={stab === "general" ? "on" : ""} onClick={() => setStab("general")}>General</button>
              <button type="button" role="tab" aria-selected={stab === "audio"} className={stab === "audio" ? "on" : ""} onClick={() => setStab("audio")}>Audio</button>
              <button type="button" role="tab" aria-selected={stab === "look"} className={stab === "look" ? "on" : ""} onClick={() => setStab("look")}>Look</button>
              <button type="button" role="tab" aria-selected={stab === "data"} className={stab === "data" ? "on" : ""} onClick={() => setStab("data")}>Data</button>
              <button type="button" role="tab" aria-selected={stab === "more"} className={stab === "more" ? "on" : ""} onClick={() => setStab("more")}>More</button>
            </div>
            {stab === "general" && (<>
            <div className="pop-title">Answer quality</div>
            <div className="seg">
              {(["turbo", "auto", "private", "best"] as Quality[]).map((q) => (
                <button type="button" key={q} className={`seg-btn ${quality === q ? "on" : ""}`} onClick={() => setQuality(q)} title={q === "turbo" ? "Fastest" : q === "auto" ? "Recommended" : q === "private" ? "100% on your computer" : "Highest quality"}>
                  <Icon name={q === "turbo" ? "sparkle" : q === "auto" ? "brain" : q === "private" ? "lock" : "trophy"} size={15} />
                  <span>{q === "turbo" ? "Turbo" : q === "auto" ? "Auto" : q === "private" ? "Private" : "Best"}</span>
                </button>
              ))}
            </div>
            <div className="pop-title">Preferences</div>
            <div className="pop-group">
              <button type="button" className={`pop-opt ${dark ? "on" : ""}`} onClick={() => setDark((v) => !v)}><Icon name="sparkle" size={16} /><span className="pop-opt-name">Dark mode</span><span className={`sw ${dark ? "on" : ""}`} aria-hidden="true"><i /></span></button>
              <button type="button" className={`pop-opt ${autopilot ? "on" : ""}`} onClick={() => { const n = !autopilot; setAutopilot(n); setAutopilotMode(n).catch(() => { setAutopilot(!n); showToast("Couldn't change Autopilot — SAM didn't save it."); }); }}><Icon name="refresh" size={16} /><span className="pop-opt-name">Autopilot</span><span className={`sw ${autopilot ? "on" : ""}`} aria-hidden="true"><i /></span></button>
              <button type="button" className={`pop-opt elon ${elon ? "on" : ""}`} onClick={toggleElon}><Icon name="sparkle" size={16} /><span className="pop-opt-name">Elon Mode</span><span className="pop-opt-sub">{elon ? "Off-leash — no ask-first at all. Deletes recoverable (30-day bin); outward actions aren't." : "No safety asks"}</span></button>
            </div>
            </>)}
            {stab === "audio" && (<>
            <div className="pop-title">Audio &amp; camera</div>
            <div className="pop-group">
              <button type="button" className="pop-opt danger-opt" onClick={() => { stopAllAV(); setSettingsOpen(false); }}><Icon name="close" size={16} /><span className="pop-opt-name">Stop audio &amp; camera</span><span className="pop-opt-sub">Stops everything</span></button>
              <button type="button" className={`pop-opt ${listening ? "on" : ""}`} onClick={toggleVoice}><Icon name="voice" size={16} /><span className="pop-opt-name">Mic — dictate{listening ? " · listening" : ""}</span><span className={`sw ${listening ? "on" : ""}`} aria-hidden="true"><i /></span></button>
              <button type="button" className={`pop-opt ${speakReplies ? "on" : ""}`} onClick={() => setSpeakReplies((v) => !v)}><Icon name="voice" size={16} /><span className="pop-opt-name">SAM talks back</span><span className={`sw ${speakReplies ? "on" : ""}`} aria-hidden="true"><i /></span></button>
              <button type="button" className={`pop-opt ${wakeOn ? "on" : ""}`} onClick={() => setWakeOn((v) => !v)}><Icon name="bell" size={16} /><span className="pop-opt-name">Wake word</span><span className={`sw ${wakeOn ? "on" : ""}`} aria-hidden="true"><i /></span></button>
              <button type="button" className={`pop-opt ${guardian ? "on" : ""}`} onClick={toggleGuardian}><Icon name="eye" size={16} /><span className="pop-opt-name">Guardian camera</span><span className={`sw ${guardian ? "on" : ""}`} aria-hidden="true"><i /></span></button>
            </div>
            </>)}
            {stab === "look" && (<>
            <div className="pop-title">Skin</div>
            <div className="skin-row">
              {[["classic", "Classic", "☀️"], ["jarvis", "Jarvis", "🤖"], ["ember", "Ember", "🔥"], ["stealth", "Stealth", "🥷"], ["midnight", "Midnight", "🌙"], ["nord", "Nord", "❄️"], ["dracula", "Dracula", "🧛"], ["linen", "Linen", "📜"], ["aurora", "Aurora", "🌌"]].map(([id, label, ic]) => (
                <button type="button" key={id} className={`skin-chip ${skin === id ? "on" : ""}`} onClick={() => setSkin(id)} aria-label={`Theme: ${label}`} title={`Theme: ${label}`}>
                  <div className={`skin-prev prev-${id}`}></div>
                  <div className="skin-chip-label">{ic} {label}</div>
                </button>
              ))}
            </div>
            </>)}
            {stab === "data" && (<>
            <div className="pop-title">Your data</div>
            <div className="pop-group">
              <button type="button" className="pop-opt" onClick={() => { setLearnedOpen(true); setSettingsOpen(false); }}><Icon name="brain" size={16} /><span className="pop-opt-name">What SAM has learned about you</span><span className="pop-opt-sub">On-device</span></button>
              <button type="button" className="pop-opt" onClick={() => { setAutonomyOpen(true); setSettingsOpen(false); }}><Icon name="shield" size={16} /><span className="pop-opt-name">What can SAM do on its own?</span><span className="pop-opt-sub">All off</span></button>
              <button type="button" className="pop-opt" onClick={() => { setYourSamOpen(true); setSettingsOpen(false); }}><Icon name="chart" size={16} /><span className="pop-opt-name">Your SAM</span><span className="pop-opt-sub">0 data sent</span></button>
            </div>
            <div className="pop-title">Do more</div>
            <div className="pop-group">
              <button type="button" className="pop-opt" onClick={() => { setWorkflowsOpen(true); setSettingsOpen(false); }}><Icon name="refresh" size={16} /><span className="pop-opt-name">Workflows</span><span className="pop-opt-sub">Pauses on risk</span></button>
              <button type="button" className="pop-opt" onClick={() => { setNotebookOpen(true); setSettingsOpen(false); }}><Icon name="book" size={16} /><span className="pop-opt-name">Notebooks</span><span className="pop-opt-sub">Your sources</span></button>
              <button type="button" className="pop-opt" onClick={() => { setUsageOpen(true); setSettingsOpen(false); }}><Icon name="markets" size={16} /><span className="pop-opt-name">Live usage</span><span className="pop-opt-sub">Live</span></button>
            </div>
            <div className="pop-title">Help</div>
            <div className="pop-group">
              <button type="button" className="pop-opt" onClick={() => { setDoctorOpen(true); setSettingsOpen(false); }}><Icon name="settings" size={16} /><span className="pop-opt-name">SAM isn't working?</span><span className="pop-opt-sub">Self-check</span></button>
              <button type="button" className="pop-opt" onClick={() => { exportChat(); setSettingsOpen(false); }}><Icon name="download" size={16} /><span className="pop-opt-name">Export this chat</span><span className="pop-opt-sub">Download</span></button>
              <button type="button" className="pop-opt" onClick={() => { if ("Notification" in window) Notification.requestPermission(); setSettingsOpen(false); }}><Icon name="bell" size={16} /><span className="pop-opt-name">Desktop notifications</span><span className="pop-opt-sub">Permission</span></button>
            </div>
            </>)}
            {stab === "more" && (<>
            <div className="pop-title">Keys &amp; brains</div>
            <div className="pop-group">
              <button type="button" className="pop-opt" onClick={() => { setAdminOpen(true); setSettingsOpen(false); }}><Icon name="key" size={16} /><span className="pop-opt-name">API keys &amp; providers</span><span className="pop-opt-sub">9 live</span></button>
            </div>
            <div className="pop-title">Devices</div>
            <div className="pop-group">
              <button type="button" className="pop-opt" onClick={() => { setAdminFocus("phone"); setAdminOpen(true); setSettingsOpen(false); }}><Icon name="phone" size={16} /><span className="pop-opt-name">Use SAM on your phone</span><span className="pop-opt-sub">QR code</span></button>
            </div>
            <div className="pop-sub-label">👥 Who's using SAM · <b>{profile.name}</b></div>
            {profiles.filter((p) => p.name && p.name.toLowerCase() !== profile.name.toLowerCase()).slice(0, 6).map((p) => (
              <button type="button" key={p.name} className="pop-opt" onClick={() => { switchTo(p); setSettingsOpen(false); }}><span className="pop-opt-name">Switch to {p.name}</span><span className="pop-opt-sub">Their own memory &amp; chats</span></button>
            ))}
            <button type="button" className="pop-opt" onClick={() => { setProfile({ name: "" }); setOnboardName(""); setOnboardAbout(""); setSettingsOpen(false); }}><span className="pop-opt-name">＋ Add someone</span><span className="pop-opt-sub">A new person — fresh, private memory</span></button>
            {(() => { const n = (status?.models?.providers || []).filter((p: any) => p.tier === "free" && p.keys > 0).length; return n ? <div className="pop-lanes">✓ {n} free {n === 1 ? "brain" : "brains"} ready — SAM rotates so you never hit a limit</div> : null; })()}
            <div className="pop-note">SAM can act for you — reading &amp; searching happen automatically; anything risky asks first.</div>
            </>)}
          </div>
        </>, document.body)}
      </header>

      {update?.behind && (
        <div className="update-bar">
          {updating === "done" ? (
            <><span>✨ Updated — restart SAM to apply the new version.</span>
              <button type="button" className="update-go" onClick={() => location.reload()}>Reload</button></>
          ) : update.url ? (
            // Packaged app — no git to pull, so send them to the signed installer download.
            <><span>✨ SAM {update.latest} is available{update.current ? ` (you have ${update.current})` : ""}.</span>
              <a className="update-go" href={update.url} target="_blank" rel="noreferrer" onClick={() => setTimeout(() => setUpdate(null), 500)}>Download</a></>
          ) : (
            <><span>✨ A new version of SAM is available.</span>
              <button type="button" className="update-go" disabled={!!updating} onClick={async () => {
                setUpdating("…"); const r = await runUpdate();
                setUpdating(r.ok ? "done" : ""); if (!r.ok) sysNote("Update failed: " + (r.error || "unknown"));
              }}>{updating ? "Evolving…" : "Update now"}</button></>
          )}
          <button type="button" className="update-x" onClick={() => setUpdate(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      <div className="shell">
      <aside className="side">
        <div className="side-head"><span className="side-title">Chats</span><button type="button" className="side-new" onClick={newChat} title="New chat">＋</button></div>
        <div className="side-folders">
          <button type="button" className={`side-folder ${!folderFilter ? "on" : ""} ${dragChat ? "droppable" : ""}`} onClick={() => setFolderFilter("")}
            onDragOver={(e) => { if (dragChat) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain") || dragChat; if (id) moveToFolder(id, ""); setDragChat(""); }}>All</button>
          {folders.map((f) => (
            <button type="button" key={f} className={`side-folder ${folderFilter === f ? "on" : ""} ${dragChat ? "droppable" : ""}`} onClick={() => setFolderFilter(folderFilter === f ? "" : f)}
              onDoubleClick={() => renameFolder(f)} title={`Filter by ${f}`}
              onDragOver={(e) => { if (dragChat) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain") || dragChat; if (id) { moveToFolder(id, f); showToast(`Moved to 📁 ${f}`); } setDragChat(""); }}>📁 {f}</button>
          ))}
          <button type="button" className="side-folder add" onClick={addFolder} title="New folder">＋</button>
          {/* Rename/delete only appear for the SELECTED folder — discoverable without adding
              two buttons per chip, and replaces the undiscoverable double-click-to-rename. */}
          {folderFilter && folders.includes(folderFilter) && (<>
            <button type="button" className="side-folder edit-folder" onClick={() => renameFolder(folderFilter)} title={`Rename folder "${folderFilter}"`}>✎</button>
            <button type="button" className="side-folder del-folder" onClick={() => deleteFolder(folderFilter)} title={`Delete folder "${folderFilter}"`}>🗑</button>
          </>)}
        </div>
        <ChatList convos={convos} activeId={activeId} folders={folders} folderFilter={folderFilter} dragChat={dragChat}
          onOpen={openConvo} onDelete={deleteConvo} onRename={renameConvo} onTogglePin={togglePin}
          onMoveToFolder={moveToFolder} setDragChat={setDragChat} />
        <button type="button" className="side-foot" onClick={() => setImportOpen(true)}><Icon name="download" /> Import your history</button>
      </aside>
      <div className="center">
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: event delegation for .code-copy buttons, which are real buttons with keyboard access */}
      <main className="chat" ref={chatRef} onScroll={onScroll} onClick={(e) => {
        const btn = (e.target as HTMLElement).closest(".code-copy") as HTMLElement | null;
        if (!btn) return;
        const code = btn.parentElement?.querySelector("code")?.textContent || "";
        navigator.clipboard.writeText(code).then(() => { btn.textContent = "Copied ✓"; setTimeout(() => { if (btn) btn.textContent = "Copy"; }, 1400); }).catch(() => {/* clipboard needs permission/focus — the button just doesn't confirm */});
      }}>
        {findOpen && (
          // biome-ignore lint/a11y/noStaticElementInteractions: onClick only stops propagation to the chat's delegated copy handler
          // biome-ignore lint/a11y/useKeyWithClickEvents: onClick only stops propagation to the chat's delegated copy handler
          <div className="find-bar" onClick={(e) => e.stopPropagation()}>
            <span className="find-ic">🔍</span>
            <input ref={findRef} className="find-input" value={findQ} placeholder="Find in conversation…"
              onChange={(e) => { setFindQ(e.target.value); setFindIdx(0); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); if (findMatches.length) setFindIdx((x) => (e.shiftKey ? (x - 1 + findMatches.length) : (x + 1)) % findMatches.length); }
                else if (e.key === "Escape") { setFindOpen(false); setFindQ(""); }
              }} />
            <span className="find-count">{findQ.trim() ? (findMatches.length ? `${Math.min(findIdx, findMatches.length - 1) + 1}/${findMatches.length}` : "0") : ""}</span>
            <button type="button" className="find-nav" disabled={!findMatches.length} onClick={() => setFindIdx((x) => (x - 1 + findMatches.length) % findMatches.length)} aria-label="Previous">↑</button>
            <button type="button" className="find-nav" disabled={!findMatches.length} onClick={() => setFindIdx((x) => (x + 1) % findMatches.length)} aria-label="Next">↓</button>
            <button type="button" className="find-nav" onClick={() => { setFindOpen(false); setFindQ(""); }} aria-label="Close">✕</button>
          </div>
        )}
        {started && messages.some((m) => m.pinned) && (
          <div className="pinned-bar">
            <div className="pb-head"><span className="pb-title"><Icon name="pin" /> Pinned</span></div>
            <div className="pb-list">
              {messages.map((m, i) => m.pinned ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: render-only pinned view; order is stable
                <div key={i} className="pb-item">
                  <div className="pb-text md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
                  <button type="button" className="mini" onClick={() => setMessages((ms) => ms.map((msg, idx) => idx === i ? { ...msg, pinned: false } : msg))}>Unpin</button>
                </div>
              ) : null)}
            </div>
          </div>
        )}
        {started && swarms.some(s => s.status === "running" || s.status === "paused" || s.status === "planning") && (
          <div className="pinned-bar" style={{ borderColor: "var(--c-blue)" }}>
            <div className="pb-head"><span className="pb-title">🐝 Active Swarm</span></div>
            <div className="pb-list">
              {swarms.filter(s => s.status !== "done" && s.status !== "error").map(s => (
                <div key={s.id} className="pb-item" style={{ flexDirection: "column", alignItems: "flex-start", gap: 8 }}>
                  <div><strong>Goal:</strong> {s.goal}</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
                    {s.agents.map(a => (
                      <div key={a.id} className="chip" style={{ background: a.status === 'paused' ? 'var(--c-err-bg)' : 'var(--c-bg2)', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 200, flex: 1 }}>
                        <div style={{ fontWeight: 500 }}>{a.emoji} {a.name} <span style={{ opacity: 0.5, fontSize: 12, fontWeight: 'normal', marginLeft: 4 }}>{a.status}</span></div>
                        <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>{a.task}</div>
                        {a.status === 'paused' && a.pendingTool && (
                          <div style={{ marginTop: 8, padding: 8, background: 'rgba(0,0,0,0.1)', borderRadius: 4, width: '100%', boxSizing: 'border-box' }}>
                            <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--c-err)' }}>Requires Approval: {a.pendingTool}</div>
                            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>{a.pendingPreview || a.pendingActivity}</div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                              <button type="button" className="mini" onClick={() => approveSwarmAgent(s.id, a.id, true).then(() => getSwarms().then(setSwarms))}>Approve</button>
                              <button type="button" className="mini" style={{ opacity: 0.7 }} onClick={() => approveSwarmAgent(s.id, a.id, false).then(() => getSwarms().then(setSwarms))}>Reject</button>
                            </div>
                          </div>
                        )}
                        {a.status === 'running' && <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>{a.pendingActivity || "Working..."}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {!started ? (
          <div className="welcome">
            <div className="hello">{greeting(profile.name)}</div>
            <div className="hello-sub">I can answer, draft, search the web, call people, and take action on your computer. Ask me anything, or try one of these:</div>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button type="button" key={s} className="chip" onClick={() => { setInput(s); inputRef.current?.focus(); }}>{s}</button>
              ))}
            </div>
            <div className="tip">{randomTip()}</div>
            <div className="welcome-keys">Press <kbd>⌘P</kbd> for commands · <button type="button" className="linkish" onClick={() => setRosterOpen(true)}><Icon name="people" /> Meet the team</button> · <button type="button" className="linkish" onClick={() => setImportOpen(true)}><Icon name="download" /> Import your history</button></div>
          </div>
        ) : (
          <div className="thread">
            {messages.map((m, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: find navigation references message indices — index is the identity here
              <div key={i} id={`msg-${i}`} className={`msg-anchor ${findMatches.includes(i) ? (i === findMatches[Math.min(findIdx, findMatches.length - 1)] ? "find-current" : "find-match") : ""}`}>
              <MemoizedMessageRow
                m={m}
                i={i}
                isExpanded={expanded.has(i)}
                isCopied={copied === i}
                isPinned={m.pinned}
                isPlaying={playing === i}
                isLast={i === messages.length - 1}
                onFollowUp={(q: string) => sendRef.current(q)}
                onExpand={(idx: number) => toggleExpand(idx)}
                onCopy={(text: string, idx: number) => copyMsg(text, idx)}
                onTogglePin={(idx: number) => setMessages((ms) => ms.map((msg, midx) => midx === idx ? { ...msg, pinned: !msg.pinned } : msg))}
                onQuote={(text: string) => quoteReply(text)}
                onTogglePlay={(text: string, idx: number) => {
                  if (playing === idx) { stopSpeaking(); setPlaying(null); }
                  else { stopSpeaking(); setPlaying(idx); ttsSpeak(text, () => setPlaying((p) => (p === idx ? null : p))); }
                }}
                onRegenerate={regenerate}
                onEdit={(idx: number) => editResend(idx)}
                onPowerUp={() => setWizardOpen(true)}
              />
              </div>
            ))}
            {team && (
              <div className="row sam">
                <div className="who">SAM · assembling the team</div>
                <div className="team-panel">
                  {team.crew.length === 0
                    ? <div className="team-planning"><span className="team-spin" /> Breaking this down…</div>
                    : team.crew.map((c: any, ci: number) => {
                        const key = c.id ?? c.specialist ?? ci;   // task id (unique) — 2 tasks can share a specialist
                        const done = team.done[key] !== undefined;
                        const active = team.active[key];
                        return (
                          <div key={key} className={`team-member ${done ? "done" : active ? "active" : "waiting"}`}>
                            <span className="tm-emoji">{c.emoji}</span>
                            <div className="tm-body">
                              <div className="tm-name">{c.name} <span className="tm-status">{done ? "✓ done" : active ? "working…" : "queued"}</span></div>
                              <div className="tm-task">{c.task}</div>
                            </div>
                          </div>
                        );
                      })}
                </div>
              </div>
            )}
            {live && (
              <div className="row sam">
                <div className="who">SAM</div>
                {live.trace.length > 0 && <ProgressTracker steps={live.trace} answering={!!live.text} />}
                {live.text
                  ? <WidgetRenderer text={live.text} />
                  : live.trace.length === 0 && <div className="bubble thinking"><span></span><span></span><span></span></div>}
              </div>
            )}
            {loading && !live && !pending && (
              <div className="row sam"><div className="who">SAM</div><div className="bubble thinking"><span></span><span></span><span></span></div></div>
            )}
            {pending && !loading && (
              <div className="row sam">
                <div className="who">SAM</div>
                {pending.trace && pending.trace.length > 0 && <TraceStrip steps={pending.trace} />}
                <div className="confirm">
                  <div className="confirm-head">⚠️ SAM wants to do this — approve?</div>
                  <div className="confirm-what">{pending.activity}</div>
                  {pending.preview && <pre className="confirm-preview">{pending.preview}</pre>}
                  <div className="confirm-actions">
                    <button type="button" className="btn-approve" onClick={() => decide(true)}>Approve</button>
                    <button type="button" className="btn-allow" onClick={() => decide(true, true)} title="Approve and never ask again for this action">Always allow</button>
                    <button type="button" className="btn-cancel" onClick={() => decide(false)}>Don't</button>
                  </div>
                </div>
              </div>
            )}
            <div ref={msgEnd} />
          </div>
        )}
        {started && scrollPct > 2 && <div className="read-progress" style={{ width: `${scrollPct}%` }} />}
        {started && scrollPct > 28 && <button type="button" className="scroll-btn top" onClick={() => chatRef.current?.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Scroll to top">↑</button>}
        {started && !atBottom && <button type="button" className="scroll-btn" onClick={() => msgEnd.current?.scrollIntoView({ behavior: "smooth" })} aria-label="Scroll to latest">↓</button>}
      </main>

      {stranger && (
        <div className="stranger-bar">
          <span className="stranger-txt">🙋 Someone new: <em>{stranger.slice(0, 90)}</em> — want me to remember them?</span>
          <input className="stranger-input" placeholder="Their name" value={strangerName} onChange={(e) => setStrangerName(e.target.value)}
            onKeyDown={async (e) => { if (e.key === "Enter" && strangerName.trim()) { await fetch("/api/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: strangerName.trim(), look: stranger }) }); showToast(`✓ I'll recognise ${strangerName.trim()} now`); setStranger(null); setStrangerName(""); } }} />
          <button type="button" className="stranger-save" disabled={!strangerName.trim()} onClick={async () => { await fetch("/api/people", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: strangerName.trim(), look: stranger }) }); showToast(`✓ I'll recognise ${strangerName.trim()} now`); setStranger(null); setStrangerName(""); }}>Remember</button>
          <button type="button" className="stranger-dismiss" onClick={() => { setStranger(null); setStrangerName(""); }}>✕</button>
        </div>
      )}
      <footer className="composer">
        {attachments.length > 0 && (
          <div className="attach-row">
            {attachments.map((a, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only attachment list; order is stable
              <div key={i} className="attach">
                {a.kind === "image" ? <img src={a.data} alt={a.name} /> : <span className="attach-file">📄</span>}
                <span className="attach-name">{a.name}</span>
                <button type="button" className="attach-x" onClick={() => setAttachments((as) => as.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
              </div>
            ))}
          </div>
        )}
        {input.startsWith("/") && !input.includes(" ") && COMMANDS.some(([c]) => c.startsWith(input.toLowerCase())) && (
          <div className="cmd-hints">
            {COMMANDS.filter(([c]) => c.startsWith(input.toLowerCase())).map(([c, d]) => (
              <button type="button" key={c} className="cmd-hint" onClick={() => { const takesArg = c === "/team" || c === "/ninjas"; setInput(takesArg ? c + " " : c); inputRef.current?.focus(); if (!takesArg) { setTimeout(() => send(c), 0); } }}>
                <span className="ch-cmd">{c}</span><span className="ch-desc">{d}</span>
              </button>
            ))}
          </div>
        )}
        <div className="composer-inner">
          <input ref={fileRef} type="file" multiple accept="image/*,.txt,.md,.csv,.json,.js,.ts,.log,.html,.css,.pdf" style={{ display: "none" }} onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          {/* biome-ignore lint/a11y/noStaticElementInteractions: hover wrapper (onMouseLeave dismiss); contains a real button */}
          <div className="plus-wrap" onMouseLeave={() => setPlusOpen(false)}>
            <button type="button" className={`plus ${plusOpen ? "open" : ""}`} onClick={() => setPlusOpen(!plusOpen)} title="Actions" aria-label="Actions">+</button>
            {plusOpen && (
              <div className="plus-menu">
                <button type="button" className="plus-opt" onClick={() => { fileRef.current?.click(); setPlusOpen(false); }}><span className="icon">📄</span> Add file or photo</button>
                <button type="button" className="plus-opt" onClick={() => { setInput("/team "); inputRef.current?.focus(); setPlusOpen(false); }}><span className="icon">🤝</span> Assemble Team</button>
                <button type="button" className="plus-opt" onClick={() => { setInput("/ninjas "); inputRef.current?.focus(); setPlusOpen(false); }}><span className="icon">🥷</span> Deploy Ninjas</button>
                <button type="button" className="plus-opt" onClick={() => { lookThroughCamera(); setPlusOpen(false); }}><span className="icon">👁️</span> Look (Vision)</button>
                <button type="button" className="plus-opt" onClick={() => { whoIsThis(); setPlusOpen(false); }}><span className="icon">🙋</span> Who's this? (learn faces)</button>
                <button type="button" className="plus-opt" onClick={() => { snapPhoto(); setPlusOpen(false); }}><span className="icon">📸</span> Take a photo</button>
                <button type="button" className="plus-opt" onClick={() => { scanTextFromCamera(); setPlusOpen(false); }}><span className="icon">📄</span> Scan text (camera)</button>
                <button type="button" className="plus-opt" onClick={() => { scanQR(); setPlusOpen(false); }}><span className="icon">🔳</span> Scan QR / barcode</button>
                <button type="button" className="plus-opt" onClick={() => { readAloudScan(); setPlusOpen(false); }}><span className="icon">🔈</span> Read this aloud</button>
                <button type="button" className="plus-opt" onClick={() => { findObject(); setPlusOpen(false); }}><span className="icon">🔎</span> Find my… (camera)</button>
                <button type="button" className="plus-opt" onClick={() => { toggleTimelapse(); setPlusOpen(false); }}><span className="icon">⏱️</span> {timelapse ? "Stop timelapse watch" : "Timelapse watch"}</button>
                <button type="button" className="plus-opt" onClick={() => { toggleGuardian(); setPlusOpen(false); }}><span className="icon">🛡️</span> {guardian ? "Disable Guardian" : "Enable Guardian"}</button>
                <button type="button" className="plus-opt" onClick={() => { setToolsOpen(true); setPlusOpen(false); }}><span className="icon">🛠️</span> What I can do</button>
              </div>
            )}
          </div>
          {quality === "turbo" && (
            <button type="button" className="turbo-pill" title="⚡ Turbo is on — one fast call, no tools. Click to switch back to Automatic."
              onClick={() => { setQuality("auto"); showToast("Switched to Automatic"); }}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 9px", marginRight: 6, borderRadius: 999, border: "1px solid var(--accent, #E8673A)", background: "transparent", color: "var(--accent, #E8673A)", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", cursor: "pointer", flexShrink: 0 }}>
              ⚡ Turbo
            </button>
          )}
          <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            onPaste={(e) => { const imgs = Array.from(e.clipboardData.items).filter((it) => it.type.startsWith("image/")).map((it) => it.getAsFile()).filter(Boolean) as File[]; if (imgs.length) { e.preventDefault(); const dt = new DataTransfer(); imgs.forEach((f) => { dt.items.add(f); }); onFiles(dt.files); } }}
            placeholder="Message SAM…  (⌘P for commands · /help)" rows={1} />
          <button type="button" className={`mic ${listening ? "on" : ""}`} onClick={toggleVoice} title="Speak your message" aria-label="Voice input">🎤</button>
          <button type="button" className={`mic ${speakReplies ? "on" : ""}`} onClick={() => setSpeakReplies((v) => !v)} title={speakReplies ? "SAM talks back — on" : "Have SAM talk back"} aria-label="Speak replies">{speakReplies ? "🔊" : "🔇"}</button>
          {loading
            ? <button type="button" className="send stop" onClick={stop} aria-label="Stop">■</button>
            : <button type="button" className="send" onClick={() => send()} disabled={!input.trim() && attachments.length === 0} aria-label="Send">↑</button>}
        </div>
        <div className="hint">SAM is private &amp; runs free on your computer · it asks before doing anything risky · <a href="https://richhabits.github.io/sam/" target="_blank" rel="noopener noreferrer" className="hint-link">richhabits.github.io/sam</a></div>
      </footer>
      </div>
      {ctxOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: context-panel scrim; click-outside close
        // biome-ignore lint/a11y/useKeyWithClickEvents: context-panel scrim; click-outside close
        <div className="ctx-scrim" onClick={() => setCtxOpen(false)} />
      )}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: event delegation for .ctx-act buttons, which are real buttons with keyboard access */}
      <aside className={ctxOpen ? "ctx open" : "ctx"}
        onClick={(e) => { if ((e.target as HTMLElement).closest(".ctx-act")) setCtxOpen(false); }}>
        <div className="ctx-title">Context</div>
        <div className="ctx-brand">{activeBrand ? activeBrand.name : mode === "business" ? "All businesses" : "Personal"}</div>
        <div className="ctx-label">Quick actions</div>
        <button type="button" className="ctx-act" onClick={() => { setInput("/team "); inputRef.current?.focus(); }}><Icon name="team" /> Assemble the Team</button>
        <button type="button" className="ctx-act" onClick={() => { setInput("/ninjas "); inputRef.current?.focus(); }}><Icon name="ninja" /> Deploy the Ninjas</button>
        <button type="button" className="ctx-act" onClick={openStudio}><Icon name="studio" /> Open Studio</button>
        <button type="button" className="ctx-act" onClick={lookThroughCamera}><Icon name="eye" /> Look (camera)</button>
        <button type="button" className="ctx-act" onClick={() => setRosterOpen(true)}><Icon name="people" /> Meet the team</button>
        <button type="button" className="ctx-act" onClick={() => setMarketsOpen(true)}><Icon name="markets" /> Markets</button>
        <button type="button" className="ctx-act" onClick={() => setColosseumOpen(true)}><Icon name="trophy" /> Colosseum</button>
        <button type="button" className="ctx-act" onClick={() => setDashOpen(true)}><Icon name="chart" /> Dashboard</button>
        <div className="ctx-label">Live status</div>
        <div className="ctx-live">
          <div className="ctx-row"><span className={`ctx-dot ${status ? "on" : ""}`} />{status ? "Connected" : "Starting…"}</div>
          {(() => { const n = (status?.models?.providers || []).filter((p: any) => p.tier === "free" && p.keys > 0).length; return <div className="ctx-row"><span className="ctx-ic">🧠</span>{n ? `${n} free brains rotating` : "Local Ollama (free)"}</div>; })()}
          {swarms.filter((s) => s.status === "running" || s.status === "planning" || s.status === "paused").slice(0, 3).map((s) => {
            const done = s.agents.filter((a) => a.status === "done").length;
            return <button type="button" key={s.id} className="ctx-swarm" onClick={() => setDashOpen(true)} title="Open the swarm in Dashboard">
              <span className="ctx-ic">🐝</span><span className="ctx-swarm-goal">{s.goal}</span>
              <span className="ctx-swarm-prog">{s.status === "planning" ? "…" : s.status === "paused" ? "⏸" : `${done}/${s.agents.length}`}</span>
            </button>;
          })}
          {status?.vault?.count != null && status.vault.count > 0 && <button type="button" className="ctx-row ctx-click" onClick={() => setMemoryOpen(true)} title="See everything SAM remembers about you — all on your machine, deletable any time"><span className="ctx-ic">💭</span>Remembers {status.vault.count} thing{status.vault.count === 1 ? "" : "s"} about you</button>}
          <div className="ctx-row"><span className="ctx-ic">{quality === "private" ? "🔒" : quality === "best" ? "✨" : "⚡"}</span>{quality === "private" ? "Private · local only" : quality === "best" ? "Best quality" : "Auto · free"}</div>
          {autopilot && <div className="ctx-row"><span className="ctx-ic">✈️</span>Autopilot on</div>}
          {elon && <div className="ctx-row danger"><span className="ctx-ic">⚡</span>Elon Mode ON</div>}
          {guardian && <div className="ctx-row"><span className="ctx-ic">🛡️</span>Guardian watching</div>}
        </div>
      </aside>
      </div>

      {marketsOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by Esc
        // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by Esc
        <div className="drawer-wrap" onClick={() => setMarketsOpen(false)}>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div><div className="drawer-title">Markets</div><div className="drawer-sub">Live quotes · free · no API key</div></div>
              <button type="button" className="icon-btn" onClick={() => loadQuotes()} title="Refresh" aria-label="Refresh">{quotesLoading ? "…" : "⟳"}</button>
            </div>
            <div className="mkt-add">
              <input value={tickerInput} onChange={(e) => setTickerInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") addTicker(); }}
                placeholder="Add a ticker — AAPL · BTC-USD · ^GSPC" aria-label="Add ticker" />
              <button type="button" onClick={addTicker} title="Add">＋</button>
            </div>
            <ul className="mkt-list">
              {quotesLoading && !quotes.length && <li className="mkt-empty">Loading…</li>}
              {!quotesLoading && !watchlist.length && <li className="mkt-empty">No tickers yet — add one above.</li>}
              {quotes.map((q) => (
                <li key={q.symbol} className="mkt-row">
                  <span className="mkt-sym">{q.symbol}</span>
                  {q.ok ? (
                    <span className="mkt-nums">
                      <span className="mkt-price">{q.price.toFixed(2)}{q.currency && q.currency !== "USD" ? ` ${q.currency}` : ""}</span>
                      <span className={"mkt-chg " + (q.change > 0 ? "up" : q.change < 0 ? "down" : "")}>
                        {q.change > 0 ? "▲" : q.change < 0 ? "▼" : "→"} {q.change >= 0 ? "+" : ""}{q.changePct.toFixed(2)}%
                      </span>
                    </span>
                  ) : <span className="mkt-err">{q.error || "no data"}</span>}
                  <button type="button" className="mkt-del" onClick={() => removeTicker(q.symbol)} aria-label="Remove">✕</button>
                </li>
              ))}
            </ul>
            <div className="mkt-note">Not financial advice · quotes may be delayed.</div>
          </aside>
        </div>
      )}
      {colosseumOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by Esc
        // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by Esc
        <div className="drawer-wrap" onClick={() => setColosseumOpen(false)}>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div><div className="drawer-title">⚔️ Colosseum</div><div className="drawer-sub">Your free brains, ranked head-to-head by Elo.</div></div>
              <button type="button" className="admin-save" onClick={runBenchmark} disabled={arenaLoading}>{arenaLoading ? "Fighting…" : "Run benchmark"}</button>
            </div>
            {arenaStatus?.current && !arenaLoading && (
              <div className={arenaStatus.stale ? "lb-fresh stale" : "lb-fresh"}>
                {arenaStatus.stale
                  ? `⚠️ Last ranking is ${Math.round(arenaStatus.ageDays ?? 0)}d old — too stale to trust, so routing is back to its default order. Run a benchmark to refresh.`
                  : `🧭 Steering routing now: ${arenaStatus.current.top} first · ranked ${(arenaStatus.ageDays ?? 0) < 1 ? "today" : `${Math.round(arenaStatus.ageDays ?? 0)}d ago`}.`}
                <button type="button" className="lb-reset" onClick={resetRanking} title="Forget the ranking — free-tier routing goes back to its default order">Reset to default</button>
              </div>
            )}
            {arenaLoading && <div className="mkt-empty">Each brain answers, an impartial judge scores every match — this takes about a minute.</div>}
            {arena?.error && <div className="mkt-empty">{arena.error}</div>}
            {!arenaLoading && !arena && <div className="mkt-empty">Press <b>Run benchmark</b> — SAM pits its rotating free brains against each other and ranks who wins.</div>}
            {arena?.leaderboard && (
              <ol className="lb-list">
                {arena.leaderboard.map((r: any, i: number) => (
                  <li key={r.id} className="lb-row">
                    <span className="lb-rank">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`}</span>
                    <span className="lb-name">{r.label}</span>
                    <span className="lb-wlt">{r.wins}-{r.losses}-{r.ties}</span>
                    <span className="lb-elo">{Math.round(r.elo)}</span>
                  </li>
                ))}
              </ol>
            )}
            {arena?.leaderboard && arena.leaderboard.length > 0 && (
              <div className="lb-steer">🧭 <b>{arena.leaderboard[0].label}</b> now answers first — this ranking steers SAM's free-tier routing.</div>
            )}
            {arena?.log && <div className="mkt-note">{arena.log.length} matches judged · winner by helpfulness, correctness &amp; clarity</div>}
          </aside>
        </div>
      )}
      {historyOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by Esc
        // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by Esc
        <div className="drawer-wrap left" onClick={() => setHistoryOpen(false)}>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
          <aside className="drawer drawer-l" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div><div className="drawer-title">Chats</div><div className="drawer-sub">Your conversations, saved on this computer.</div></div>
              <button type="button" className="icon-btn" onClick={() => { newChat(); setHistoryOpen(false); }} title="New chat">＋</button>
            </div>
            {convos.length > 4 && (
              <input className="convo-search" value={convoSearch} onChange={(e) => setConvoSearch(e.target.value)} placeholder="Search chats…" />
            )}
            {/* Same titling + content search as the desktop sidebar — this drawer is the
                only chat list on narrow screens, where `.side` is hidden. */}
            <ul className="convo-list">
              {convos.filter((c) => matchesQuery(convoSearch, displayTitle(c), c.messages.map((m) => m.text))).map((c) => (
                <li key={c.id} className={c.id === activeId ? "active" : ""}>
                  <button type="button" className="convo-open" onClick={() => openConvo(c.id)}>{displayTitle(c)}</button>
                  <button type="button" className="convo-del" onClick={() => deleteConvo(c.id)} aria-label="Delete">✕</button>
                </li>
              ))}
              {convoSearch.trim() && convos.filter((c) => matchesQuery(convoSearch, displayTitle(c), c.messages.map((m) => m.text))).length === 0 && (
                <li className="convo-empty">No chats match “{convoSearch}”.</li>
              )}
            </ul>
          </aside>
        </div>
      )}

      {memoryOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by Esc
        // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by Esc
        <div className="drawer-wrap" onClick={() => setMemoryOpen(false)}>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div><div className="drawer-title">What SAM remembers about you</div><div className="drawer-sub">{mem ? `${mem.count} thing${mem.count === 1 ? "" : "s"} learned · all on your computer — nothing left your device` : "Loading…"}</div></div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {/* Export → download a local Markdown file. Wipe → confirm, scoped delete, reload. Both 100% local. */}
                <button type="button" className="icon-btn" title="Download your memory as a Markdown file (stays on your device)" onClick={async () => {
                  const { markdown } = await exportMemory();
                  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
                  const a = document.createElement("a"); a.href = url; a.download = "sam-memory.md"; a.click(); URL.revokeObjectURL(url);
                }}>⬇︎ Export</button>
                <button type="button" className="icon-btn" title="Forget everything SAM has learned about you" onClick={async () => {
                  if (!window.confirm("Forget everything SAM has learned about you? This can't be undone.")) return;
                  await clearMemory(); loadMemory();
                }}>🗑 Forget everything</button>
                <button type="button" className="icon-btn" onClick={() => setMemoryOpen(false)} aria-label="Close">✕</button>
              </div>
            </div>
            {(() => {
              const KINDS: [string, string][] = [["fact", "🧠 Facts"], ["plan", "🗺️ Plans"], ["decision", "✅ Decisions"], ["task", "📌 Open loops"]];
              // A delete that fails must not look like it worked — the row would silently return.
              const del = (id: string) => forgetMemory(id).then(loadMemory).catch(() => showToast("Couldn't forget that — it's still stored."));
              if (mem && mem.count === 0) return <div className="drawer-empty">Nothing learned yet. As you chat, SAM saves durable facts, plans and decisions here — all on your machine, and you can delete any of them any time.</div>;
              const q = memQuery.trim().toLowerCase();
              const match = (items: { id: string; text: string; ts: number }[]) => q ? items.filter((it) => it.text.toLowerCase().includes(q)) : items;
              const anyMatch = KINDS.some(([kind]) => match(mem?.groups?.[kind] || []).length);
              return <>
                <input className="mem-search" value={memQuery} onChange={(e) => setMemQuery(e.target.value)} placeholder="Search your memory…" />
                {!anyMatch && q ? <div className="drawer-empty">No memories match “{memQuery}”.</div> : <div className="mem-groups">
                {KINDS.map(([kind, label]) => {
                  const items = match(mem?.groups?.[kind] || []);
                  if (!items.length) return null;
                  return <div key={kind} className="mem-group">
                    <div className="mem-group-title">{label} <span className="mem-count">{items.length}</span></div>
                    <ul className="drawer-list">
                      {items.map((it) => (
                        <li key={it.id} className="mem-item">
                          <span className="d-msg">{it.text}</span>
                          <button type="button" className="mem-del" title="Forget this" onClick={() => del(it.id)}>✕</button>
                        </li>
                      ))}
                    </ul>
                  </div>;
                })}
              </div>}
              </>;
            })()}
          </aside>
        </div>
      )}

      {rosterOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: modal scrim; click-outside close, Esc handled elsewhere
        <div className="roster-scrim" onMouseDown={() => setRosterOpen(false)}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: content panel; onMouseDown only stops scrim-close propagation */}
          <div className="roster" onMouseDown={(e) => e.stopPropagation()}>
            <div className="roster-head">
              <div>
                <div className="roster-title">🤝 Meet the team</div>
                <div className="roster-sub">{roster.length} specialists SAM can call on. Say <b>/team &lt;job&gt;</b> and it assembles the right ones.</div>
              </div>
              <button type="button" className="icon-btn" onClick={() => setRosterOpen(false)} aria-label="Close">✕</button>
            </div>
            <input className="roster-search" value={rosterSearch} onChange={(e) => setRosterSearch(e.target.value)} placeholder="Search the roster — name, discipline, skill…" autoFocus />
            <div className="roster-grid">
              {roster.filter((a) => { const q = rosterSearch.trim().toLowerCase(); return !q || `${a.name} ${a.modeledOn} ${a.brief}`.toLowerCase().includes(q); }).map((a) => (
                <div key={a.id} className="roster-card">
                  <div className="rc-emoji">{a.emoji}</div>
                  <div className="rc-body">
                    <div className="rc-name">{a.name}</div>
                    <div className="rc-modeled">{a.modeledOn}</div>
                    <div className="rc-brief">{a.brief}</div>
                  </div>
                </div>
              ))}
              {roster.length === 0 && <div className="roster-empty">Loading the roster…</div>}
            </div>
          </div>
        </div>
      )}

      {importOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: modal scrim; click-outside close, Esc handled elsewhere
        <div className="roster-scrim" onMouseDown={() => !importBusy && setImportOpen(false)}>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: content panel; onMouseDown only stops scrim-close propagation */}
          <div className="import-modal" onMouseDown={(e) => e.stopPropagation()}>
            <div className="roster-head">
              <div>
                <div className="roster-title"><Icon name="download" /> Import your history</div>
                <div className="roster-sub">Drop a ChatGPT / Claude / Gemini export — SAM learns the durable facts about you, privately, on your machine.</div>
              </div>
              <button type="button" className="icon-btn" onClick={() => setImportOpen(false)} aria-label="Close">✕</button>
            </div>
            <label className={`import-drop ${importDrag ? "over" : ""}`}
              onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); if (!importDrag) setImportDrag(true); } }}
              onDragLeave={(e) => { if (e.currentTarget === e.target) setImportDrag(false); }}
              onDrop={(e) => { e.preventDefault(); setImportDrag(false); readImportFile(e.dataTransfer.files?.[0]); }}>
              <input type="file" accept=".json,.txt,.md,.csv" style={{ display: "none" }} onChange={(e) => readImportFile(e.target.files?.[0])} />
              <div className="import-drop-icon">🗂️</div>
              {importFile
                ? <div className="import-drop-loaded">✓ {importFile} — ready to import</div>
                : <><div className="import-drop-title">Drag &amp; drop your history here</div><div className="import-drop-sub">.json / .txt — or click to browse. SAM ignores any instructions inside; it only extracts facts about you.</div></>}
            </label>
            {/* Step 1. A raw ChatGPT export is tens of thousands of lines, nearly all noise —
                this asks the assistant that already knows you to write one page instead, and you
                get to read exactly what you're handing over before you hand it over. */}
            <div className="handoff">
              <div className="handoff-h">
                <span className="handoff-step">1</span>
                <span className="handoff-t">Get your profile from your old assistant</span>
                <button type="button" className="handoff-copy" onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(HANDOFF_PROMPT);
                    setToast("Prompt copied — paste it into ChatGPT, Claude or Gemini");
                  } catch {
                    // Clipboard can be blocked (insecure origin, permissions). Say so and show the
                    // text rather than failing silently — the whole point is getting it to them.
                    setToast("Couldn't copy — select the text below and copy it manually");
                  }
                }}><Icon name="copy" size={14} /> Copy prompt</button>
              </div>
              <div className="handoff-sub">{HANDOFF_BLURB}</div>
              <textarea className="handoff-text" readOnly value={HANDOFF_PROMPT}
                onFocus={(e) => e.currentTarget.select()} rows={4} />
            </div>
            <details className="import-paste"><summary>…or paste text instead</summary>
              <textarea value={importText} onChange={(e) => { setImportText(e.target.value); setImportFile(""); }} placeholder="Paste a chunk of your history…" />
            </details>
            <div className="import-foot">
              <button type="button" className="import-go" onClick={runImport} disabled={importBusy || !importText.trim()}>{importBusy ? "Reading…" : "Import"}</button>
              <span className="import-note">{importResult || "Runs on your free/local brain — private, no cloud needed."}</span>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}

      {palette && (() => {
        const acts: { icon: string; label: string; hint?: string; run: () => void }[] = [
          { icon: "chat", label: "New chat", hint: "⌘K", run: () => newChat() },
          { icon: "refresh", label: "Regenerate last answer", run: () => regenerate() },
          { icon: "team", label: "Assemble the Team", hint: "big jobs", run: () => setInput("/team ") },
          { icon: "people", label: "Meet the team (browse specialists)", run: () => setRosterOpen(true) },
          { icon: "download", label: "Import my ChatGPT/Claude history", run: () => setImportOpen(true) },
          { icon: "studio", label: "Open SAM Studio (image/video)", run: () => openStudio() },
          { icon: "ninja", label: "Deploy the Ninjas", hint: "fix a problem", run: () => setInput("/ninjas ") },
          { icon: "voice", label: "Voice mode", run: () => setVoiceMode(true) },
          { icon: "eye", label: "Look through the camera", run: () => lookThroughCamera() },
          { icon: "shield", label: guardian ? "Stop Guardian" : "Start Guardian", run: () => toggleGuardian() },
          { icon: "chart", label: "Open Dashboard", run: () => setDashOpen(true) },
          { icon: "grid", label: "What SAM can do", run: () => setToolsOpen(true) },
          { icon: "clock", label: "Chat history", run: () => setHistoryOpen(true) },
          { icon: "brain", label: "Memory", run: () => setMemoryOpen(true) },
          { icon: "key", label: "API keys & providers", run: () => setAdminOpen(true) },
          { icon: "book", label: "Notebooks (grounded research)", run: () => setNotebookOpen(true) },
          { icon: "chart", label: "Live usage", run: () => setUsageOpen(true) },
          { icon: "sparkle", label: "Power up SAM (free key wizard)", run: () => setWizardOpen(true) },
          { icon: "settings", label: "Settings", run: () => setSettingsOpen(true) },
          { icon: "search", label: "Find in conversation", hint: "⌘F", run: () => { setFindOpen(true); setTimeout(() => findRef.current?.focus(), 40); } },
          { icon: "⬇️", label: "Export this chat (download)", run: () => { exportChat(); showToast("⬇️ Chat downloaded"); } },
          { icon: "doc", label: "Copy whole chat", run: () => { const md = messages.map((m) => `${m.role === "sam" ? "SAM" : "You"}: ${m.text}`).join("\n\n"); navigator.clipboard.writeText(md).then(() => showToast("📋 Chat copied")).catch(() => {/* clipboard needs permission/focus — the button just doesn't confirm */}); } },
          { icon: "lock", label: "Private mode — local only", run: () => setQuality("private") },
          { icon: "sparkle", label: "Auto — free brains", run: () => setQuality("auto") },
          { icon: "sparkle", label: "Best quality", run: () => setQuality("best") },
          { icon: dark ? "☀️" : "🌙", label: dark ? "Light theme" : "Dark theme", run: () => setDark((v) => !v) },
          { icon: "pencil", label: "Text size: Large", run: () => setFontSize("large") },
          { icon: "pencil", label: "Text size: Normal", run: () => setFontSize("normal") },
          { icon: "chart", label: "Text size: Compact", run: () => setFontSize("compact") },
          { icon: "studio", label: "Skin: Classic", run: () => setSkin("classic") },
          { icon: "sliders", label: "Skin: Jarvis", run: () => setSkin("jarvis") },
          { icon: "sparkle", label: "Skin: Ember", run: () => setSkin("ember") },
          { icon: "ninja", label: "Skin: Stealth", run: () => setSkin("stealth") },
          { icon: "🌙", label: "Skin: Midnight", run: () => setSkin("midnight") },
          { icon: "❄️", label: "Skin: Nord", run: () => setSkin("nord") },
          { icon: "🧛", label: "Skin: Dracula", run: () => setSkin("dracula") },
          { icon: "📜", label: "Skin: Linen", run: () => setSkin("linen") },
          { icon: "🌌", label: "Skin: Aurora (dark glass)", run: () => setSkin("aurora") },
          { icon: mode === "business" ? "🏠" : "💼", label: mode === "business" ? "Switch to Personal" : "Switch to Business", run: () => setMode((m) => (m === "business" ? "personal" : "business")) },
        ];
        const q = pq.trim().toLowerCase();
        const filtered = q ? acts.filter((a) => a.label.toLowerCase().includes(q)) : acts;
        const go = (a?: { run: () => void }) => { if (!a) return; setPalette(false); a.run(); };
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: command-palette scrim; click-outside close, Esc handled elsewhere
          <div className="cmdp-scrim" onMouseDown={() => setPalette(false)}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: content panel; onMouseDown only stops scrim-close propagation */}
            <div className="cmdp" onMouseDown={(e) => e.stopPropagation()}>
              <input ref={paletteRef} className="cmdp-input" value={pq} placeholder="Run a command…  ↑↓ move · ↵ run · esc close"
                onChange={(e) => { setPq(e.target.value); setPi(0); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setPi((i) => Math.min(filtered.length - 1, i + 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setPi((i) => Math.max(0, i - 1)); }
                  else if (e.key === "Enter") { e.preventDefault(); go(filtered[pi]); }
                }} />
              <div className="cmdp-list">
                {filtered.length === 0
                  ? <div className="cmdp-empty">No matching command.</div>
                  : filtered.map((a, i) => (
                    // biome-ignore lint/a11y/noStaticElementInteractions: command-palette item; keyboard nav handled by the input's arrow/enter keydown
                    <div key={a.label} className={`cmdp-item ${i === pi ? "on" : ""}`} onMouseEnter={() => setPi(i)} onMouseDown={() => go(a)}>
                      <span className="cmdp-ic">{ICON_NAMES.has(a.icon) ? <Icon name={a.icon as IconName} size={16} /> : a.icon}</span>
                      <span className="cmdp-label">{a.label}</span>
                      {a.hint && <span className="cmdp-hint">{a.hint}</span>}
                    </div>
                  ))}
              </div>
              <div className="cmdp-foot">⌘P anytime · {filtered.length} action{filtered.length === 1 ? "" : "s"}</div>
            </div>
          </div>
        );
      })()}

      <Suspense fallback={null}>
        {voiceMode && <VoiceMode name={profile.name} ask={voiceAsk} onClose={() => setVoiceMode(false)} />}
        {adminOpen && <Admin onClose={() => { setAdminOpen(false); setAdminFocus(undefined); }} focus={adminFocus} />}
        {notebookOpen && <Notebook onClose={() => setNotebookOpen(false)} speak={speakText} />}
        {usageOpen && <Usage onClose={() => setUsageOpen(false)} />}
        {wizardOpen && <KeyWizard onClose={() => setWizardOpen(false)} onAllProviders={() => { setWizardOpen(false); setAdminOpen(true); }} />}
        {dashOpen && <Dashboard onClose={() => setDashOpen(false)} onAddKeys={() => setAdminOpen(true)} />}
        {autonomyOpen && <AutonomyPane onClose={() => setAutonomyOpen(false)} />}
        {learnedOpen && <LearnedPane onClose={() => setLearnedOpen(false)} />}
        {workflowsOpen && <WorkflowsPane onClose={() => setWorkflowsOpen(false)} />}
        {yourSamOpen && <YourSam onClose={() => setYourSamOpen(false)} />}
        {doctorOpen && <DoctorPane onClose={() => setDoctorOpen(false)} />}
      </Suspense>

      {toolsOpen && (
        // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop; keyboard close handled by Esc
        // biome-ignore lint/a11y/useKeyWithClickEvents: modal backdrop; keyboard close handled by Esc
        <div className="drawer-wrap" onClick={() => setToolsOpen(false)}>
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: content pane; onClick only stops backdrop-close propagation */}
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div><div className="drawer-title">What SAM can do</div><div className="drawer-sub">Reading &amp; searching happen automatically. 🔒 = SAM asks you first.</div></div>
              <button type="button" className="icon-btn" onClick={() => setToolsOpen(false)} aria-label="Close">✕</button>
            </div>
            <ul className="tool-list">
              {tools.map((t) => (<li key={t.name}><span className="t-lock">{t.safe ? "•" : "🔒"}</span><span className="t-desc">{t.description}</span></li>))}
            </ul>
          </aside>
        </div>
      )}
    </div>
  );
}
