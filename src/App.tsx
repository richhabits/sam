import React, { useState, useEffect, useRef, lazy, Suspense, memo } from "react";
import { command, confirm as confirmAction, streamCommand, setUser, getProjects, getLog, getStatus, getTools, checkUpdate, runUpdate, getProactive, streamTeam, getAutopilot, setAutopilotMode, AgentResult, Attachment, Swarm, getSwarms, startSwarm, approveSwarmAgent, addSchedule, getSchedules, getRoster } from "./lib/api";
import { renderMarkdown } from "./lib/md";
import { startWakeListener } from "./lib/wake";
import { speak as ttsSpeak, stopSpeaking } from "./lib/tts";
import WidgetRenderer from "./WidgetRenderer";
// Heavy panels are lazy-loaded — they only download when you actually open them,
// so the initial app is slimmer and paints faster.
const VoiceMode = lazy(() => import("./VoiceMode"));
const Admin = lazy(() => import("./Admin"));
const Dashboard = lazy(() => import("./Dashboard"));

interface Profile { name: string; about?: string; language?: string }
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

interface Msg { role: "user" | "sam"; text: string; how?: string; trace?: string[]; at?: string; pinned?: boolean }
interface Convo { id: string; title: string; messages: Msg[]; at: number }

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Render a trace line with any URLs as clickable source links.
function traceLine(t: string) {
  return t.split(/(https?:\/\/[^\s]+)/g).map((p, i) =>
    /^https?:\/\//.test(p)
      ? <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="src-link">{p.replace(/^https?:\/\/(www\.)?/, "").slice(0, 44)}</a>
      : <span key={i}>{p}</span>
  );
}

// A mini icon for each step SAM takes — so you can watch the A→X journey.
const STEP_ICONS: [RegExp, string][] = [
  [/git ?hub|repo|issue|pull request|\bpr\b|commit|pushing|branch/i, "🐙"],
  [/git status/i, "🔀"],
  [/your apps/i, "📱"], [/your socials/i, "📲"],
  [/search|google|looking up/i, "🔍"], [/read/i, "📖"],
  [/weather/i, "🌤️"], [/location/i, "📍"], [/time/i, "🕐"],
  [/email|mail|gmail/i, "📧"], [/call|ring|facetime|phone/i, "📞"],
  [/message|imessage|text/i, "💬"], [/calendar|diary|event/i, "📅"],
  [/remind/i, "⏰"], [/notif/i, "🔔"],
  [/file|folder|desktop|spotlight/i, "📁"], [/screenshot|screen/i, "📸"],
  [/music|play|song|track/i, "🎵"], [/download/i, "⬇️"],
  [/open|browser|url|website/i, "🌐"], [/command|terminal|running/i, "💻"],
  [/click|type|mouse|keyboard/i, "🖱️"],
];
function stepIcon(a: string): string {
  for (const [re, ic] of STEP_ICONS) if (re.test(a)) return ic;
  return "⚙️";
}

// Uber-style live progress tracker: mini icons + a connecting line, the current
// step pulsing, everything before it ticked off. Shows the journey from A → X.
function ProgressTracker({ steps, answering }: { steps: string[]; answering: boolean }) {
  const items = steps.map((s) => ({ icon: stepIcon(s), label: s.replace(/^✓\s*/, "") }));
  if (answering) items.push({ icon: "✍️", label: "Writing your answer" });
  return (
    <div className="tracker" role="status" aria-label="SAM progress">
      {items.map((it, i) => {
        const isLast = i === items.length - 1;
        return (
          <div key={i} className={`tstep ${isLast ? "active" : "done"}`}>
            <span className="tdot"><span className="tico">{it.icon}</span></span>
            <span className="tlabel">{traceLine(it.label)}</span>
          </div>
        );
      })}
    </div>
  );
}

// Compact completed journey for finished/paused messages (icons, no animation).
function TraceStrip({ steps }: { steps: string[] }) {
  return (
    <div className="tracker">
      {steps.map((t, j) => (
        <div key={j} className="tstep done">
          <span className="tdot"><span className="tico">{stepIcon(t)}</span></span>
          <span className="tlabel">{traceLine(t.replace(/^✓\s*/, ""))}</span>
        </div>
      ))}
    </div>
  );
}
const uid = () => (crypto?.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
const titleOf = (msgs: Msg[]) => {
  const first = msgs.find((m) => m.role === "user")?.text;
  return first ? (first.length > 42 ? first.slice(0, 42) + "…" : first) : "New chat";
};

function howAnswered(provider?: string): string {
  if (!provider) return "";
  if (provider.startsWith("ollama")) return "on your computer";
  if (provider === "none") return "offline";
  if (/claude|anthropic|gpt-4|openai/i.test(provider)) return "best";
  return "fast";   // cerebras / groq / nvidia / mistral / github / gemini — all free & quick
}

const COMMANDS: [string, string][] = [
  ["/team", "🤝 Assemble the crew — big jobs, run in parallel"],
  ["/ninjas", "🥷 Deploy the problem squad — find & deal with it"],
  ["/private", "🔒 100% on your computer (local only)"],
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

type Quality = "auto" | "private" | "best";
const QUALITY_TIER: Record<Quality, string | undefined> = { auto: "free", private: "local", best: "premium" };

const LS = "sam.v2";
function loadState(): { convos: Convo[]; activeId: string; brand: string; quality: Quality } {
  try {
    const s = JSON.parse(localStorage.getItem(LS) || "{}");
    if (s.convos?.length) return { brand: "", quality: "auto", ...s };
  } catch {}
  const id = uid();
  return { convos: [{ id, title: "New chat", messages: [], at: Date.now() }], activeId: id, brand: "", quality: "auto" };
}
const MemoizedMessageRow = memo(function MemoizedMessageRow({
  m, i, isExpanded, isCopied, isPinned, isPlaying, isLast,
  onFollowUp, onExpand, onCopy, onCopyMarkdown, onTogglePin, onQuote, onTogglePlay, onRegenerate, onEdit
}: any) {
  return (
    <div className={`row ${m.role}`}>
      <div className="who">{m.role === "sam" ? "SAM" : "You"}{m.at && <span className="at"> · {m.at}</span>}</div>
      {m.trace && m.trace.length > 0 && <TraceStrip steps={m.trace} />}
      {m.text && (m.role === "sam"
        ? (m.text.length > 1600 && !isExpanded
            ? <div className="msg-collapsed"><WidgetRenderer text={m.text} onFollowUp={onFollowUp} /><button className="show-more" onClick={() => onExpand(i)}>Show more ▾</button></div>
            : <div><WidgetRenderer text={m.text} onFollowUp={onFollowUp} />{m.text.length > 1600 && <button className="show-less" onClick={() => onExpand(i)}>Show less ▴</button>}</div>)
        : <div className="bubble">{m.text}</div>)}
      {m.role === "sam" && m.text && (
        <div className="msg-actions">
          <button className="mini" onClick={() => onCopy(m.text, i)}>{isCopied ? "Copied ✓" : "Copy"}</button>
          <button className="mini" onClick={() => onCopyMarkdown(m.text, i)}>📋 Markdown</button>
          <button className="mini" onClick={() => onTogglePin(i)}>{isPinned ? "Unpin" : "📌 Pin"}</button>
          <button className="mini" onClick={() => onQuote(m.text)}>↩ Reply</button>
          <button className="mini" onClick={() => onTogglePlay(m.text, i)}>{isPlaying ? "⏹ Stop" : "🔊 Listen"}</button>
          {isLast && <button className="mini" onClick={onRegenerate}>Regenerate</button>}
          {m.how && <span className="how">answered {m.how}</span>}
        </div>
      )}
      {m.role === "user" && (
        <div className="msg-actions"><button className="mini" onClick={() => onEdit(i)}>Edit</button></div>
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
  const init = loadState();
  const [projects, setProjects] = useState<{ id: string; name: string; themeColor?: string }[]>([]);
  const [log, setLog] = useState<{ time: string; msg: string }[]>([]);
  const [status, setStatus] = useState<any>(null);
  const [tools, setTools] = useState<{ name: string; safe: boolean; description: string }[]>([]);

  const [convos, setConvos] = useState<Convo[]>(init.convos);
  const [activeId, setActiveId] = useState<string>(init.activeId);
  const [messages, setMessages] = useState<Msg[]>(init.convos.find((c) => c.id === init.activeId)?.messages || []);

  const [brand, setBrand] = useState<string>(init.brand);
  const [mode, setMode] = useState<"business" | "personal">(() => { try { return (localStorage.getItem("sam.mode") as any) || "business"; } catch { return "business"; } });
  const [quality, setQuality] = useState<Quality>(init.quality);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pending, setPending] = useState<AgentResult | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [live, setLive] = useState<{ text: string; trace: string[] } | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [scrollPct, setScrollPct] = useState(0);
  const [listening, setListening] = useState(false);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem("sam.dark") === "1"; } catch { return false; } });
  const [skin, setSkin] = useState(() => { try { return localStorage.getItem("sam.skin") || "classic"; } catch { return "classic"; } });
  const [speakReplies, setSpeakReplies] = useState(() => { try { return localStorage.getItem("sam.speak") === "1"; } catch { return false; } });
  const [wakeOn, setWakeOn] = useState(() => { try { return localStorage.getItem("sam.wake") === "1"; } catch { return false; } });
  const [profile, setProfile] = useState<Profile>(loadProfile);
  const [onboardName, setOnboardName] = useState("");
  const [onboardAbout, setOnboardAbout] = useState("");
  const [onboardLang, setOnboardLang] = useState("English");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [voiceMode, setVoiceMode] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
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
  useEffect(() => { if (rosterOpen && !roster.length) getRoster().then((d) => setRoster(d.crew || d || [])).catch(() => {}); }, [rosterOpen]);
  useEffect(() => { try { if (fontSize === "normal") document.documentElement.removeAttribute("data-fontsize"); else document.documentElement.setAttribute("data-fontsize", fontSize); localStorage.setItem("sam.fontsize", fontSize); } catch {} }, [fontSize]);
  const [swarms, setSwarms] = useState<Swarm[]>([]);
  const [playing, setPlaying] = useState<number | null>(null);
  const [team, setTeam] = useState<{ crew: any[]; done: Record<string, string>; active: Record<string, boolean> } | null>(null);
  const [guardian, setGuardian] = useState(false);
  const [autopilot, setAutopilot] = useState(false);
  useEffect(() => { getAutopilot().then((a) => setAutopilot(!!a.on)).catch(() => {}); }, []);
  const guardStream = useRef<MediaStream | null>(null);
  const guardIv = useRef<any>(null);
  const guardPrev = useRef<Uint8ClampedArray | null>(null);
  const [update, setUpdate] = useState<{ behind: boolean } | null>(null);
  const [updating, setUpdating] = useState("");
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const msgEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getProjects().then(setProjects).catch(() => {});
    getStatus().then(setStatus).catch(() => setStatus(null));
    getTools().then(setTools).catch(() => {});
    checkUpdate().then((u) => u.behind && setUpdate(u)).catch(() => {});
    refreshLog();
    inputRef.current?.focus();
    // SAM reaching out first — morning brief / due nudges appear as messages.
    const showProactive = () => getProactive().then((p) => {
      if (p.items?.length) {
        setMessages((m) => [...m, ...p.items.map((it) => ({ role: "sam" as const, text: it.text, how: it.type === "brief" ? "morning brief" : "nudge", at: now() }))]);
        if ("Notification" in window && Notification.permission === "granted") {
          try { new Notification("SAM", { body: p.items[0].text }); } catch {}
        }
      }
    }).catch(() => {});
    showProactive();
    // keep the connection dot honest + check for proactive messages (light: every 3 min)
    const iv = setInterval(() => getStatus().then(setStatus).catch(() => setStatus(null)), 12000);
    const pv = setInterval(showProactive, 180000);
    // Continuous Swarm polling
    const sv = setInterval(() => getSwarms().then(setSwarms).catch(() => {}), 5000);
    getSwarms().then(setSwarms).catch(() => {});
    return () => { clearInterval(iv); clearInterval(pv); clearInterval(sv); };
  }, []);
  useEffect(() => { if (atBottom) msgEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading, pending]);
  useEffect(() => { const el = inputRef.current; if (!el) return; el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 160) + "px"; }, [input]);

  // keep the active conversation in sync + persist everything
  useEffect(() => {
    setConvos((cs) => cs.map((c) => (c.id === activeId ? { ...c, messages, title: titleOf(messages), at: Date.now() } : c)));
  }, [messages]);
  useEffect(() => { try { localStorage.setItem(LS, JSON.stringify({ convos: convos.slice(0, 50), activeId, brand, quality })); } catch {} }, [convos, activeId, brand, quality]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "t") { e.preventDefault(); setInput("/team "); inputRef.current?.focus(); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "n") { e.preventDefault(); setInput("/ninjas "); inputRef.current?.focus(); }
      else if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); newChat(); }
      else if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); setPalette((v) => !v); setPq(""); setPi(0); }
      else if (mod && e.key.toLowerCase() === "f" && messages.length > 0) { e.preventDefault(); setFindOpen(true); setFindIdx(0); setTimeout(() => findRef.current?.select(), 30); }
      else if (e.key === "Escape") { if (palette) setPalette(false); else if (findOpen) { setFindOpen(false); setFindQ(""); } else if (loading) stop(); else { setHistoryOpen(false); setMemoryOpen(false); setToolsOpen(false); setSettingsOpen(false); setDashOpen(false); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loading, palette, findOpen, messages.length]);
  useEffect(() => { if (palette) setTimeout(() => paletteRef.current?.focus(), 30); }, [palette]);
  // Matching message indices for ⌘F find-in-chat.
  const findMatches = findQ.trim() ? messages.map((m, i) => (m.text || "").toLowerCase().includes(findQ.toLowerCase()) ? i : -1).filter((i) => i >= 0) : [];
  useEffect(() => { if (findOpen && findMatches.length) { const el = document.getElementById(`msg-${findMatches[Math.min(findIdx, findMatches.length - 1)]}`); el?.scrollIntoView({ behavior: "smooth", block: "center" }); } }, [findIdx, findQ, findOpen]);

  useEffect(() => {
    const handler = (e: any) => { e.preventDefault(); setDeferredPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => { try { document.documentElement.setAttribute("data-theme", dark ? "dark" : "light"); localStorage.setItem("sam.dark", dark ? "1" : "0"); } catch {} }, [dark]);
  useEffect(() => { try { if (skin === "classic") document.documentElement.removeAttribute("data-skin"); else document.documentElement.setAttribute("data-skin", skin); localStorage.setItem("sam.skin", skin); } catch {} }, [skin]);
  useEffect(() => { try { localStorage.setItem("sam.speak", speakReplies ? "1" : "0"); } catch {} }, [speakReplies]);
  useEffect(() => { setUser({ ...profile, mode }); try { localStorage.setItem("sam.profile", JSON.stringify(profile)); localStorage.setItem("sam.mode", mode); } catch {} }, [profile, mode]);

  // Hands-free wake: whistle or double-clap opens Voice Mode.
  useEffect(() => {
    if (!wakeOn) { try { localStorage.setItem("sam.wake", "0"); } catch {}; return; }
    let stop: (() => void) | null = null;
    startWakeListener(() => setVoiceMode(true)).then((s) => (stop = s)).catch(() => {
      setWakeOn(false); sysNote("I couldn't access the mic for hands-free wake. Allow mic access and try again.");
    });
    try { localStorage.setItem("sam.wake", "1"); } catch {}
    return () => { stop?.(); };
  }, [wakeOn]);

  function finishOnboarding() {
    const name = onboardName.trim();
    if (!name) return;
    const p = { name, about: onboardAbout.trim() || undefined, language: onboardLang || "English" };
    setProfile(p); setUser({ ...p, mode });
  }

  const refreshLog = () => getLog().then(setLog).catch(() => {});

  // Voice input — cross-platform, browser-native (no install, free).
  function toggleVoice() {
    const SR: any = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { sysNote("Voice input needs Chrome. Everything else works in any browser."); return; }
    if (listening) { setListening(false); return; }
    const rec = new SR(); rec.lang = "en-GB"; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e: any) => { const t = e.results[0][0].transcript; setInput((v) => (v ? v + " " : "") + t); };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true); rec.start();
    inputRef.current?.focus();
  }
  function speakText(text: string) { ttsSpeak(text); }

  function onScroll() { const el = chatRef.current; if (!el) return; setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80); const max = el.scrollHeight - el.clientHeight; setScrollPct(max > 40 ? Math.min(100, (el.scrollTop / max) * 100) : 0); }

  function handleResult(r: AgentResult) {
    if (r.kind === "pending") { setPending(r); return; }
    setMessages((m) => [...m, { role: "sam", text: r.text || "", how: howAnswered(r.provider), trace: r.trace, at: now() }]);
    if (speakReplies && r.text) speakText(r.text);
    refreshLog();
  }

  // 🛡️ Guardian — watches the camera. Free/slim: in-browser motion detection gates the
  // vision call, so SAM only "looks" when something actually moves. Flags people it
  // doesn't recognise (notification + message + speaks it).
  function stopGuardian() {
    if (guardIv.current) { clearInterval(guardIv.current); guardIv.current = null; }
    guardStream.current?.getTracks().forEach((t) => t.stop());
    guardStream.current = null; guardPrev.current = null; setGuardian(false);
  }
  async function toggleGuardian() {
    if (guardian) { stopGuardian(); sysNote("🛡️ Guardian off."); return; }
    try {
      guardStream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      setGuardian(true);
      try { if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission(); } catch {}
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
            try { if ("Notification" in window && Notification.permission === "granted") new Notification("🛡️ SAM Guardian", { body: txt.slice(0, 140) }); } catch {}
            if (speakReplies) speakText(txt);
          } else if (txt && !/^clear/i.test(txt)) {
            setMessages((m) => [...m, { role: "sam", text: txt, how: "guardian", at: now() }]);
          }
        } catch {} finally { busy = false; }
      };
      guardIv.current = setInterval(tick, 4000);   // sample every 4s; vision only fires on motion
    } catch { sysNote("Couldn't start Guardian — allow camera access and try again."); }
  }

  // 👁️ SAM looks through the webcam — captures one frame → its vision describes it.
  async function lookThroughCamera() {
    if (loading) return;
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      const video = document.createElement("video");
      video.srcObject = stream; video.muted = true; await video.play();
      await new Promise((r) => setTimeout(r, 450));   // let the camera expose
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
      canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", 0.82);
      stream.getTracks().forEach((t) => t.stop());
      setMessages((m) => [...m, { role: "user", text: "👁️ (looking through the camera)", at: now() }]);
      setLoading(true);
      try { handleResult(await command("Look through my webcam — tell me what and who you can see, naturally and warmly.", brand || undefined, QUALITY_TIER[quality], undefined, [{ kind: "image", name: "camera.jpg", mime: "image/jpeg", data }])); }
      catch { sysNote("Couldn't see through the camera just now — need a Gemini key for vision (Settings → API keys)."); }
      setLoading(false); inputRef.current?.focus();
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      sysNote("I couldn't open the camera — allow camera access in your browser and try again.");
    }
  }

  function handleSlash(v: string): boolean {
    const cmd = v.toLowerCase();
    if (cmd === "/new" || cmd === "/clear") { newChat(); return true; }
    if (cmd === "/private") { setQuality("private"); sysNote("Switched to Private — everything runs 100% on your computer."); return true; }
    if (cmd === "/best") { setQuality("best"); sysNote("Switched to Best quality."); return true; }
    if (cmd === "/fast" || cmd === "/auto") { setQuality("auto"); sysNote("Switched to Automatic (free & capable)."); return true; }
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
    if (cmd === "/help") { sysNote("Commands: /team, /ninjas, /swarm, /schedule, /new, /private, /best, /auto, /tools, /history, /export. ⌘K new chat, Esc stop."); return true; }
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
      getSwarms().then(setSwarms).catch(() => {});
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
    if ((!value && !atts.length) || loading) return;
    if (value.startsWith("/") && !atts.length && handleSlash(value)) { setInput(""); return; }
    setInput(""); setPending(null); setAttachments([]);
    const label = value || (atts.length ? `📎 ${atts.map((a) => a.name).join(", ")}` : "");
    setMessages((m) => [...m, { role: "user", text: label, at: now() }]);
    setLoading(true);
    abortRef.current = new AbortController();

    // Attachments (photos/files) → non-streaming vision/file path.
    if (atts.length) {
      try { handleResult(await command(value || "Have a look at this.", brand || undefined, QUALITY_TIER[quality], abortRef.current.signal, atts)); }
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
        setMessages((m) => [...m, { role: "sam", text: e.text || "", trace: e.trace, how: howAnswered(e.provider), at: now() }]);
        if (speakReplies && e.text) speakText(e.text);
        refreshLog();
      }
    };
    // Seamless: if the brain is still warming up, retry once quietly before erroring.
    for (let attempt = 0; attempt < 2; attempt++) {
      try { await streamCommand(value, brand || undefined, QUALITY_TIER[quality], onEvent, abortRef.current.signal); break; }
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
    setMessages((m) => [...m, { role: "user", text: q, at: now() }]);
    try {
      const r = await command(q, brand || undefined, QUALITY_TIER[quality]);
      if (r.kind === "pending") { setPending(r); return "I need your OK for that one — I've put it on the screen for you."; }
      setMessages((m) => [...m, { role: "sam", text: r.text || "", how: howAnswered(r.provider), trace: r.trace, at: now() }]);
      refreshLog();
      return r.text || "";
    } catch { return "I couldn't reach my brain just then."; }
  }

  function stop() { abortRef.current?.abort(); setLive(null); setLoading(false); }
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
    setConvos((cs) => {
      const rest = cs.filter((c) => c.id !== id);
      if (id === activeId) { const next = rest[0] || { id: uid(), title: "New chat", messages: [], at: Date.now() }; setActiveId(next.id); setMessages(next.messages); return rest.length ? rest : [next]; }
      return rest;
    });
  }

  async function copyMsg(text: string, i: number) {
    try { await navigator.clipboard.writeText(text); setCopied(i); setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500); } catch {}
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
          <button className="onboard-go" onClick={finishOnboarding} disabled={!onboardName.trim()}>Let's go →</button>
          <div className="onboard-note">Private &amp; free — SAM runs on your computer.</div>
        </div>
      </div>
    );
  }

  const activeBrand = projects.find((p) => p.id === brand);
  const customAccent = mode === "business" && activeBrand?.themeColor ? activeBrand.themeColor : undefined;

  return (
    <div className="app" style={customAccent ? { "--accent": customAccent, "--accent-2": customAccent } as React.CSSProperties : undefined}>
      <header className="bar">
        <div className="brandmark">
          <button className="icon-btn ghost" onClick={() => setHistoryOpen(true)} title="Chat history (⌘K for new)" aria-label="History">☰</button>
          <span className="dot-live" title={status ? "Connected" : "Starting…"} />
          <span className="wordmark">SAM<span className="wm-dot">.</span></span>
          <span className="tag">by <b>HECTIC</b></span>
        </div>
        <div className="bar-right">
          {deferredPrompt && <button className="icon-btn" onClick={() => { deferredPrompt.prompt(); deferredPrompt.userChoice.then(() => setDeferredPrompt(null)); }} title="Install SAM to your Dock">⬇️ Add to Dock</button>}
          {started && <button className="icon-btn" onClick={newChat} title="New chat (⌘K)">New chat</button>}
          <button className="icon-btn voice-btn" onClick={() => setVoiceMode(true)} title="Talk to SAM out loud">🎙 Voice</button>
          
          <div className="mode-toggle" role="tablist" title="Business mind at work · Personal mind at home">
            <button role="tab" className={mode === "business" ? "on" : ""} onClick={() => setMode("business")}>💼 Business</button>
            <button role="tab" className={mode === "personal" ? "on" : ""} onClick={() => setMode("personal")}>🏠 Personal</button>
          </div>
          {mode === "business" && (
            <label className="biz">
              <span className="biz-label">Brand</span>
              <select value={brand} onChange={(e) => setBrand(e.target.value)}>
                <option value="">All my businesses</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          <button className="icon-btn" onClick={() => setDashOpen(true)} title="SAM control centre">📊 Dashboard</button>
          <button className="icon-btn" onClick={() => setSettingsOpen((v) => !v)} title="Settings" aria-label="Settings">⚙</button>
        </div>
        {settingsOpen && (
          <div className="popover" onMouseLeave={() => setSettingsOpen(false)}>
            <div className="pop-title">Answer quality</div>
            {(["auto", "private", "best"] as Quality[]).map((q) => (
              <button key={q} className={`pop-opt ${quality === q ? "on" : ""}`} onClick={() => setQuality(q)}>
                <span className="pop-opt-name">{q === "auto" ? "Automatic" : q === "private" ? "Private" : "Best"}</span>
                <span className="pop-opt-sub">{q === "auto" ? "Free & capable — recommended" : q === "private" ? "100% on your computer" : "Highest quality"}</span>
              </button>
            ))}
            <div className="pop-title" style={{ marginTop: 6 }}>Preferences</div>
            <button className={`pop-opt ${dark ? "on" : ""}`} onClick={() => setDark((v) => !v)}><span className="pop-opt-name">Dark mode</span><span className="pop-opt-sub">{dark ? "On" : "Off"}</span></button>
            <button className={`pop-opt ${autopilot ? "on" : ""}`} onClick={() => { const n = !autopilot; setAutopilot(n); setAutopilotMode(n).catch(() => {}); }}><span className="pop-opt-name">✈️ Autopilot {autopilot ? "· ON" : ""}</span><span className="pop-opt-sub">{autopilot ? "SAM handles routine work without asking (serious stuff still asks)" : "Off — SAM asks before anything risky"}</span></button>
            <div className="pop-title">Skin</div>
            <div className="skin-row">
              {[["classic", "Classic", "☀️"], ["jarvis", "Jarvis", "🤖"], ["ember", "Ember", "🔥"], ["stealth", "Stealth", "🥷"], ["midnight", "Midnight", "🌙"], ["nord", "Nord", "❄️"], ["dracula", "Dracula", "🧛"], ["linen", "Linen", "📜"]].map(([id, label, ic]) => (
                <button key={id} className={`skin-chip ${skin === id ? "on" : ""}`} onClick={() => setSkin(id)}>
                  <div className={`skin-prev prev-${id}`}></div>
                  <div className="skin-chip-label">{ic} {label}</div>
                </button>
              ))}
            </div>
            <button className={`pop-opt ${speakReplies ? "on" : ""}`} onClick={() => setSpeakReplies((v) => !v)}><span className="pop-opt-name">Read replies aloud</span><span className="pop-opt-sub">{speakReplies ? "On" : "Off"}</span></button>
            <button className={`pop-opt ${wakeOn ? "on" : ""}`} onClick={() => setWakeOn((v) => !v)}><span className="pop-opt-name">🎵 Whistle / clap to wake</span><span className="pop-opt-sub">{wakeOn ? "On — whistle or double-clap for SAM" : "Off"}</span></button>
            <button className="pop-opt" onClick={() => { if ("Notification" in window) Notification.requestPermission(); setSettingsOpen(false); }}><span className="pop-opt-name">Desktop notifications</span><span className="pop-opt-sub">Allow SAM to nudge you</span></button>
            <button className="pop-opt" onClick={() => { exportChat(); setSettingsOpen(false); }}><span className="pop-opt-name">Export this chat</span><span className="pop-opt-sub">Download as a document</span></button>
            <button className="pop-opt" onClick={() => { setAdminOpen(true); setSettingsOpen(false); }}><span className="pop-opt-name">API keys &amp; providers</span><span className="pop-opt-sub">Add your free rolling keys</span></button>
            <button className="pop-opt" onClick={() => { setProfile({ name: "" }); setOnboardName(""); setOnboardAbout(""); setSettingsOpen(false); }}><span className="pop-opt-name">Switch user</span><span className="pop-opt-sub">Signed in as {profile.name}</span></button>
            {(() => { const n = (status?.models?.providers || []).filter((p: any) => p.tier === "free" && p.keys > 0).length; return n ? <div className="pop-lanes">✓ {n} free {n === 1 ? "brain" : "brains"} ready — SAM rotates so you never hit a limit</div> : null; })()}
            <div className="pop-note">SAM can act for you — reading &amp; searching happen automatically; anything risky asks first.</div>
          </div>
        )}
      </header>

      {update?.behind && (
        <div className="update-bar">
          {updating === "done" ? (
            <><span>✨ Updated — restart SAM to apply the new version.</span>
              <button className="update-go" onClick={() => location.reload()}>Reload</button></>
          ) : (
            <><span>✨ A new version of SAM is available.</span>
              <button className="update-go" disabled={!!updating} onClick={async () => {
                setUpdating("…"); const r = await runUpdate();
                setUpdating(r.ok ? "done" : ""); if (!r.ok) sysNote("Update failed: " + (r.error || "unknown"));
              }}>{updating ? "Evolving…" : "Update now"}</button></>
          )}
          <button className="update-x" onClick={() => setUpdate(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      <main className="chat" ref={chatRef} onScroll={onScroll} onClick={(e) => {
        const btn = (e.target as HTMLElement).closest(".code-copy") as HTMLElement | null;
        if (!btn) return;
        const code = btn.parentElement?.querySelector("code")?.textContent || "";
        navigator.clipboard.writeText(code).then(() => { btn.textContent = "Copied ✓"; setTimeout(() => { if (btn) btn.textContent = "Copy"; }, 1400); }).catch(() => {});
      }}>
        {findOpen && (
          <div className="find-bar" onClick={(e) => e.stopPropagation()}>
            <span className="find-ic">🔍</span>
            <input ref={findRef} className="find-input" value={findQ} placeholder="Find in conversation…"
              onChange={(e) => { setFindQ(e.target.value); setFindIdx(0); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); if (findMatches.length) setFindIdx((x) => (e.shiftKey ? (x - 1 + findMatches.length) : (x + 1)) % findMatches.length); }
                else if (e.key === "Escape") { setFindOpen(false); setFindQ(""); }
              }} />
            <span className="find-count">{findQ.trim() ? (findMatches.length ? `${Math.min(findIdx, findMatches.length - 1) + 1}/${findMatches.length}` : "0") : ""}</span>
            <button className="find-nav" disabled={!findMatches.length} onClick={() => setFindIdx((x) => (x - 1 + findMatches.length) % findMatches.length)} aria-label="Previous">↑</button>
            <button className="find-nav" disabled={!findMatches.length} onClick={() => setFindIdx((x) => (x + 1) % findMatches.length)} aria-label="Next">↓</button>
            <button className="find-nav" onClick={() => { setFindOpen(false); setFindQ(""); }} aria-label="Close">✕</button>
          </div>
        )}
        {started && messages.some((m) => m.pinned) && (
          <div className="pinned-bar">
            <div className="pb-head"><span className="pb-title">📌 Pinned</span></div>
            <div className="pb-list">
              {messages.map((m, i) => m.pinned ? (
                <div key={i} className="pb-item">
                  <div className="pb-text md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
                  <button className="mini" onClick={() => setMessages((ms) => ms.map((msg, idx) => idx === i ? { ...msg, pinned: false } : msg))}>Unpin</button>
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
                              <button className="mini" onClick={() => approveSwarmAgent(s.id, a.id, true).then(() => getSwarms().then(setSwarms))}>Approve</button>
                              <button className="mini" style={{ opacity: 0.7 }} onClick={() => approveSwarmAgent(s.id, a.id, false).then(() => getSwarms().then(setSwarms))}>Reject</button>
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
                <button key={s} className="chip" onClick={() => { setInput(s); inputRef.current?.focus(); }}>{s}</button>
              ))}
            </div>
            <div className="tip">{randomTip()}</div>
            <div className="welcome-keys">Press <kbd>⌘P</kbd> for commands · <kbd>⌘K</kbd> for a new chat · <button className="linkish" onClick={() => setRosterOpen(true)}>👥 Meet the team</button></div>
          </div>
        ) : (
          <div className="thread">
            {messages.map((m, i) => (
              <div key={i} id={`msg-${i}`} className={`msg-anchor ${findMatches.includes(i) ? (i === findMatches[Math.min(findIdx, findMatches.length - 1)] ? "find-current" : "find-match") : ""}`}>
              <MemoizedMessageRow
                m={m}
                i={i}
                isExpanded={expanded.has(i)}
                isCopied={copied === i}
                isPinned={m.pinned}
                isPlaying={playing === i}
                isLast={i === messages.length - 1}
                onFollowUp={(q: string) => send(q)}
                onExpand={(idx: number) => toggleExpand(idx)}
                onCopy={(text: string, idx: number) => copyMsg(text, idx)}
                onCopyMarkdown={(text: string, idx: number) => copyMsg(text, idx)}
                onTogglePin={(idx: number) => setMessages((ms) => ms.map((msg, midx) => midx === idx ? { ...msg, pinned: !msg.pinned } : msg))}
                onQuote={(text: string) => quoteReply(text)}
                onTogglePlay={(text: string, idx: number) => {
                  if (playing === idx) { stopSpeaking(); setPlaying(null); }
                  else { stopSpeaking(); setPlaying(idx); ttsSpeak(text, () => setPlaying((p) => (p === idx ? null : p))); }
                }}
                onRegenerate={regenerate}
                onEdit={(idx: number) => editResend(idx)}
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
                    <button className="btn-approve" onClick={() => decide(true)}>Approve</button>
                    <button className="btn-allow" onClick={() => decide(true, true)} title="Approve and never ask again for this action">Always allow</button>
                    <button className="btn-cancel" onClick={() => decide(false)}>Don't</button>
                  </div>
                </div>
              </div>
            )}
            <div ref={msgEnd} />
          </div>
        )}
        {started && scrollPct > 2 && <div className="read-progress" style={{ width: `${scrollPct}%` }} />}
        {started && scrollPct > 28 && <button className="scroll-btn top" onClick={() => chatRef.current?.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Scroll to top">↑</button>}
        {started && !atBottom && <button className="scroll-btn" onClick={() => msgEnd.current?.scrollIntoView({ behavior: "smooth" })} aria-label="Scroll to latest">↓</button>}
      </main>

      <footer className={`composer ${dragOver ? "drag-over" : ""}`}
        onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); if (!dragOver) setDragOver(true); } }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}>
        {dragOver && <div className="drop-hint">📎 Drop files or photos to attach</div>}
        {attachments.length > 0 && (
          <div className="attach-row">
            {attachments.map((a, i) => (
              <div key={i} className="attach">
                {a.kind === "image" ? <img src={a.data} alt={a.name} /> : <span className="attach-file">📄</span>}
                <span className="attach-name">{a.name}</span>
                <button className="attach-x" onClick={() => setAttachments((as) => as.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
              </div>
            ))}
          </div>
        )}
        {input.startsWith("/") && !input.includes(" ") && COMMANDS.some(([c]) => c.startsWith(input.toLowerCase())) && (
          <div className="cmd-hints">
            {COMMANDS.filter(([c]) => c.startsWith(input.toLowerCase())).map(([c, d]) => (
              <button key={c} className="cmd-hint" onClick={() => { const takesArg = c === "/team" || c === "/ninjas"; setInput(takesArg ? c + " " : c); inputRef.current?.focus(); if (!takesArg) { setTimeout(() => send(c), 0); } }}>
                <span className="ch-cmd">{c}</span><span className="ch-desc">{d}</span>
              </button>
            ))}
          </div>
        )}
        <div className="composer-inner">
          <input ref={fileRef} type="file" multiple accept="image/*,.txt,.md,.csv,.json,.js,.ts,.log,.html,.css,.pdf" style={{ display: "none" }} onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          <div className="plus-wrap" onMouseLeave={() => setPlusOpen(false)}>
            <button className={`plus ${plusOpen ? "open" : ""}`} onClick={() => setPlusOpen(!plusOpen)} title="Actions" aria-label="Actions">+</button>
            {plusOpen && (
              <div className="plus-menu">
                <button className="plus-opt" onClick={() => { fileRef.current?.click(); setPlusOpen(false); }}><span className="icon">📄</span> Add file or photo</button>
                <button className="plus-opt" onClick={() => { setInput("/team "); inputRef.current?.focus(); setPlusOpen(false); }}><span className="icon">🤝</span> Assemble Team</button>
                <button className="plus-opt" onClick={() => { setInput("/ninjas "); inputRef.current?.focus(); setPlusOpen(false); }}><span className="icon">🥷</span> Deploy Ninjas</button>
                <button className="plus-opt" onClick={() => { lookThroughCamera(); setPlusOpen(false); }}><span className="icon">👁️</span> Look (Vision)</button>
                <button className="plus-opt" onClick={() => { toggleGuardian(); setPlusOpen(false); }}><span className="icon">🛡️</span> {guardian ? "Disable Guardian" : "Enable Guardian"}</button>
                <button className="plus-opt" onClick={() => { setToolsOpen(true); setPlusOpen(false); }}><span className="icon">🛠️</span> What I can do</button>
              </div>
            )}
          </div>
          <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            onPaste={(e) => { const imgs = Array.from(e.clipboardData.items).filter((it) => it.type.startsWith("image/")).map((it) => it.getAsFile()).filter(Boolean) as File[]; if (imgs.length) { e.preventDefault(); const dt = new DataTransfer(); imgs.forEach((f) => dt.items.add(f)); onFiles(dt.files); } }}
            placeholder="Message SAM…  (⌘P for commands · /help)" rows={1} />
          <button className={`mic ${listening ? "on" : ""}`} onClick={toggleVoice} title="Speak your message" aria-label="Voice input">🎤</button>
          <button className={`mic ${speakReplies ? "on" : ""}`} onClick={() => setSpeakReplies((v) => !v)} title={speakReplies ? "SAM talks back — on" : "Have SAM talk back"} aria-label="Speak replies">{speakReplies ? "🔊" : "🔇"}</button>
          {loading
            ? <button className="send stop" onClick={stop} aria-label="Stop">■</button>
            : <button className="send" onClick={() => send()} disabled={!input.trim() && attachments.length === 0} aria-label="Send">↑</button>}
        </div>
        <div className="hint">SAM is private &amp; runs free on your computer · it asks before doing anything risky · <a href="https://richhabits.github.io/sam/" target="_blank" rel="noopener noreferrer" className="hint-link">richhabits.github.io/sam</a></div>
      </footer>

      {historyOpen && (
        <div className="drawer-wrap left" onClick={() => setHistoryOpen(false)}>
          <aside className="drawer drawer-l" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div><div className="drawer-title">Chats</div><div className="drawer-sub">Your conversations, saved on this computer.</div></div>
              <button className="icon-btn" onClick={() => { newChat(); setHistoryOpen(false); }} title="New chat">＋</button>
            </div>
            {convos.length > 4 && (
              <input className="convo-search" value={convoSearch} onChange={(e) => setConvoSearch(e.target.value)} placeholder="🔍 Search chats…" />
            )}
            <ul className="convo-list">
              {convos.filter((c) => !convoSearch.trim() || (c.title || "").toLowerCase().includes(convoSearch.trim().toLowerCase())).map((c) => (
                <li key={c.id} className={c.id === activeId ? "active" : ""}>
                  <button className="convo-open" onClick={() => openConvo(c.id)}>{c.title || "New chat"}</button>
                  <button className="convo-del" onClick={() => deleteConvo(c.id)} aria-label="Delete">✕</button>
                </li>
              ))}
              {convoSearch.trim() && convos.filter((c) => (c.title || "").toLowerCase().includes(convoSearch.trim().toLowerCase())).length === 0 && (
                <li className="convo-empty">No chats match “{convoSearch}”.</li>
              )}
            </ul>
          </aside>
        </div>
      )}

      {memoryOpen && (
        <div className="drawer-wrap" onClick={() => setMemoryOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div><div className="drawer-title">What SAM remembers</div><div className="drawer-sub">Today's history — saved privately on your computer.</div></div>
              <button className="icon-btn" onClick={() => setMemoryOpen(false)} aria-label="Close">✕</button>
            </div>
            {log.length === 0
              ? <div className="drawer-empty">Nothing yet today. Anything you chat about gets saved here so SAM remembers next time.</div>
              : <ul className="drawer-list">{log.map((l, i) => (<li key={i}><span className="d-time">{l.time}</span><span className="d-msg">{l.msg}</span></li>))}</ul>}
          </aside>
        </div>
      )}

      {rosterOpen && (
        <div className="roster-scrim" onMouseDown={() => setRosterOpen(false)}>
          <div className="roster" onMouseDown={(e) => e.stopPropagation()}>
            <div className="roster-head">
              <div>
                <div className="roster-title">🤝 Meet the team</div>
                <div className="roster-sub">{roster.length} specialists SAM can call on. Say <b>/team &lt;job&gt;</b> and it assembles the right ones.</div>
              </div>
              <button className="icon-btn" onClick={() => setRosterOpen(false)} aria-label="Close">✕</button>
            </div>
            <input className="roster-search" value={rosterSearch} onChange={(e) => setRosterSearch(e.target.value)} placeholder="🔍 Search the roster — name, discipline, skill…" autoFocus />
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

      {toast && <div className="toast" role="status">{toast}</div>}

      {palette && (() => {
        const acts: { icon: string; label: string; hint?: string; run: () => void }[] = [
          { icon: "💬", label: "New chat", hint: "⌘K", run: () => newChat() },
          { icon: "🔄", label: "Regenerate last answer", run: () => regenerate() },
          { icon: "🤝", label: "Assemble the Team", hint: "big jobs", run: () => setInput("/team ") },
          { icon: "👥", label: "Meet the team (browse specialists)", run: () => setRosterOpen(true) },
          { icon: "🥷", label: "Deploy the Ninjas", hint: "fix a problem", run: () => setInput("/ninjas ") },
          { icon: "🎙", label: "Voice mode", run: () => setVoiceMode(true) },
          { icon: "👁️", label: "Look through the camera", run: () => lookThroughCamera() },
          { icon: "🛡️", label: guardian ? "Stop Guardian" : "Start Guardian", run: () => toggleGuardian() },
          { icon: "📊", label: "Open Dashboard", run: () => setDashOpen(true) },
          { icon: "🧰", label: "What SAM can do", run: () => setToolsOpen(true) },
          { icon: "🕑", label: "Chat history", run: () => setHistoryOpen(true) },
          { icon: "🧠", label: "Memory", run: () => setMemoryOpen(true) },
          { icon: "🔑", label: "API keys & providers", run: () => setAdminOpen(true) },
          { icon: "⚙️", label: "Settings", run: () => setSettingsOpen(true) },
          { icon: "🔍", label: "Find in conversation", hint: "⌘F", run: () => { setFindOpen(true); setTimeout(() => findRef.current?.focus(), 40); } },
          { icon: "⬇️", label: "Export this chat (download)", run: () => { exportChat(); showToast("⬇️ Chat downloaded"); } },
          { icon: "📋", label: "Copy whole chat", run: () => { const md = messages.map((m) => `${m.role === "sam" ? "SAM" : "You"}: ${m.text}`).join("\n\n"); navigator.clipboard.writeText(md).then(() => showToast("📋 Chat copied")).catch(() => {}); } },
          { icon: "🔒", label: "Private mode — local only", run: () => setQuality("private") },
          { icon: "⚡", label: "Auto — free brains", run: () => setQuality("auto") },
          { icon: "✨", label: "Best quality", run: () => setQuality("best") },
          { icon: dark ? "☀️" : "🌙", label: dark ? "Light theme" : "Dark theme", run: () => setDark((v) => !v) },
          { icon: "🔠", label: "Text size: Large", run: () => setFontSize("large") },
          { icon: "🔡", label: "Text size: Normal", run: () => setFontSize("normal") },
          { icon: "🔻", label: "Text size: Compact", run: () => setFontSize("compact") },
          { icon: "🎨", label: "Skin: Classic", run: () => setSkin("classic") },
          { icon: "🦾", label: "Skin: Jarvis", run: () => setSkin("jarvis") },
          { icon: "🔥", label: "Skin: Ember", run: () => setSkin("ember") },
          { icon: "🥷", label: "Skin: Stealth", run: () => setSkin("stealth") },
          { icon: "🌙", label: "Skin: Midnight", run: () => setSkin("midnight") },
          { icon: "❄️", label: "Skin: Nord", run: () => setSkin("nord") },
          { icon: "🧛", label: "Skin: Dracula", run: () => setSkin("dracula") },
          { icon: "📜", label: "Skin: Linen", run: () => setSkin("linen") },
          { icon: mode === "business" ? "🏠" : "💼", label: mode === "business" ? "Switch to Personal" : "Switch to Business", run: () => setMode((m) => (m === "business" ? "personal" : "business")) },
        ];
        const q = pq.trim().toLowerCase();
        const filtered = q ? acts.filter((a) => a.label.toLowerCase().includes(q)) : acts;
        const go = (a?: { run: () => void }) => { if (!a) return; setPalette(false); a.run(); };
        return (
          <div className="cmdp-scrim" onMouseDown={() => setPalette(false)}>
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
                    <div key={a.label} className={`cmdp-item ${i === pi ? "on" : ""}`} onMouseEnter={() => setPi(i)} onMouseDown={() => go(a)}>
                      <span className="cmdp-ic">{a.icon}</span>
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
        {adminOpen && <Admin onClose={() => setAdminOpen(false)} />}
        {dashOpen && <Dashboard onClose={() => setDashOpen(false)} />}
      </Suspense>

      {toolsOpen && (
        <div className="drawer-wrap" onClick={() => setToolsOpen(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div><div className="drawer-title">What SAM can do</div><div className="drawer-sub">Reading &amp; searching happen automatically. 🔒 = SAM asks you first.</div></div>
              <button className="icon-btn" onClick={() => setToolsOpen(false)} aria-label="Close">✕</button>
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
