import { useState, useEffect, useRef } from "react";
import { command, confirm as confirmAction, streamCommand, setUser, getProjects, getLog, getStatus, getTools, checkUpdate, runUpdate, AgentResult, Attachment } from "./lib/api";
import { renderMarkdown } from "./lib/md";
import { startWakeListener } from "./lib/wake";
import { speak as ttsSpeak, stopSpeaking } from "./lib/tts";
import VoiceMode from "./VoiceMode";
import Admin from "./Admin";
import Dashboard from "./Dashboard";

interface Profile { name: string; about?: string; language?: string }
const LANGUAGES = ["English", "Español", "Français", "Deutsch", "Italiano", "Português", "Nederlands", "Polski", "Türkçe", "العربية", "हिन्दी", "中文", "日本語", "한국어", "Русский"];
function loadProfile(): Profile { try { return JSON.parse(localStorage.getItem("sam.profile") || "{}"); } catch { return { name: "" }; } }
function greeting(name: string) {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  return name ? `${part}, ${name} 👋 I'm SAM.` : "Hi 👋 I'm SAM.";
}

interface Msg { role: "user" | "sam"; text: string; how?: string; trace?: string[]; at?: string }
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
    <div className="trace">
      {steps.map((t, j) => <div key={j} className="trace-line"><span className="tico-sm">{stepIcon(t)}</span> {traceLine(t.replace(/^✓\s*/, ""))}</div>)}
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

const SUGGESTIONS = [
  "Draft a friendly reply to a customer asking for a refund",
  "Search the web for the best free tools for small businesses",
  "What's on my calendar today?",
  "Call my accountant",
  "Research 5 competitors and what they charge",
  "What's the weather today?",
  "Read my latest emails and tell me what's urgent",
  "Take a screenshot and tell me what's on my screen",
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

export default function App() {
  const init = loadState();
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
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
  const [live, setLive] = useState<{ text: string; trace: string[] } | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [listening, setListening] = useState(false);
  const [dark, setDark] = useState(() => { try { return localStorage.getItem("sam.dark") === "1"; } catch { return false; } });
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
  const [playing, setPlaying] = useState<number | null>(null);
  const [update, setUpdate] = useState<{ behind: boolean } | null>(null);
  const [updating, setUpdating] = useState("");
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
    // keep the connection dot honest (brain up/down) without any noise
    const iv = setInterval(() => getStatus().then(setStatus).catch(() => setStatus(null)), 12000);
    return () => clearInterval(iv);
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); newChat(); }
      else if (e.key === "Escape") { if (loading) stop(); else { setHistoryOpen(false); setMemoryOpen(false); setToolsOpen(false); setSettingsOpen(false); setDashOpen(false); } }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loading]);

  useEffect(() => { try { document.documentElement.setAttribute("data-theme", dark ? "dark" : "light"); localStorage.setItem("sam.dark", dark ? "1" : "0"); } catch {} }, [dark]);
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

  function onScroll() { const el = chatRef.current; if (!el) return; setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80); }

  function handleResult(r: AgentResult) {
    if (r.kind === "pending") { setPending(r); return; }
    setMessages((m) => [...m, { role: "sam", text: r.text || "", how: howAnswered(r.provider), trace: r.trace, at: now() }]);
    if (speakReplies && r.text) speakText(r.text);
    refreshLog();
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
    if (cmd === "/help") { sysNote("Commands: /new, /private, /best, /auto, /tools, /history, /export. Shortcuts: ⌘K new chat, Esc stop. Or just talk — I can search, draft, plan, call people, and act on your Mac."); return true; }
    return false;
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
    let produced = false;
    const onEvent = (e: any) => {
      if (e.type === "token") { produced = true; setLive((l) => ({ text: (l?.text || "") + e.t, trace: l?.trace || [] })); }
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
        setMessages((m) => [...m, { role: "sam", text: "I couldn't reach my brain — make sure SAM's running, then try again.", at: now() }]);
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
  function regenerate() { const last = [...messages].reverse().find((m) => m.role === "user"); if (last && !loading) send(last.text); }
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

  const started = messages.length > 0 || !!pending || loading;

  // First-run onboarding — greets a brand-new user and learns their name,
  // so SAM addresses THEM (great for sharing with a mate).
  if (!profile.name) {
    return (
      <div className="app onboarding">
        <div className="onboard-card">
          <div className="onboard-emoji">👋</div>
          <div className="onboard-title">Hi, I'm SAM.</div>
          <div className="onboard-sub">Your own AI assistant — I can answer, draft, search the web, and take action on your computer. First up, what should I call you?</div>
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

  return (
    <div className="app">
      <header className="bar">
        <div className="brandmark">
          <button className="icon-btn ghost" onClick={() => setHistoryOpen(true)} title="Chat history (⌘K for new)" aria-label="History">☰</button>
          <span className="dot-live" title={status ? "Connected" : "Starting…"} />
          <span className="name">SAM</span>
          <span className="tag">your assistant</span>
        </div>
        <div className="bar-right">
          {started && <button className="icon-btn" onClick={newChat} title="New chat (⌘K)">New chat</button>}
          <button className="icon-btn voice-btn" onClick={() => setVoiceMode(true)} title="Talk to SAM out loud">🎙 Voice</button>
          <button className="icon-btn" onClick={() => setToolsOpen(true)} title="What SAM can do">What I can do</button>
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
          <button className="icon-btn" onClick={() => setMemoryOpen(true)} title="What SAM remembers">Memory</button>
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
            <button className={`pop-opt ${speakReplies ? "on" : ""}`} onClick={() => setSpeakReplies((v) => !v)}><span className="pop-opt-name">Read replies aloud</span><span className="pop-opt-sub">{speakReplies ? "On" : "Off"}</span></button>
            <button className={`pop-opt ${wakeOn ? "on" : ""}`} onClick={() => setWakeOn((v) => !v)}><span className="pop-opt-name">🎵 Whistle / clap to wake</span><span className="pop-opt-sub">{wakeOn ? "On — whistle or double-clap for SAM" : "Off"}</span></button>
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

      <main className="chat" ref={chatRef} onScroll={onScroll}>
        {!started ? (
          <div className="welcome">
            <div className="hello">{greeting(profile.name)}</div>
            <div className="hello-sub">I can answer, draft, search the web, call people, and take action on your computer. Ask me anything, or start with one of these:</div>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => { setInput(s); inputRef.current?.focus(); }}>{s}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="thread">
            {messages.map((m, i) => (
              <div key={i} className={`row ${m.role}`}>
                <div className="who">{m.role === "sam" ? "SAM" : "You"}{m.at && <span className="at"> · {m.at}</span>}</div>
                {m.trace && m.trace.length > 0 && <TraceStrip steps={m.trace} />}
                {m.text && (m.role === "sam"
                  ? <div className="bubble md" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
                  : <div className="bubble">{m.text}</div>)}
                {m.role === "sam" && m.text && (
                  <div className="msg-actions">
                    <button className="mini" onClick={() => copyMsg(m.text, i)}>{copied === i ? "Copied ✓" : "Copy"}</button>
                    <button className="mini" onClick={() => {
                      if (playing === i) { stopSpeaking(); setPlaying(null); }
                      else { stopSpeaking(); setPlaying(i); ttsSpeak(m.text, () => setPlaying((p) => (p === i ? null : p))); }
                    }}>{playing === i ? "⏹ Stop" : "🔊 Listen"}</button>
                    {i === messages.length - 1 && <button className="mini" onClick={regenerate}>Regenerate</button>}
                    {m.how && <span className="how">answered {m.how}</span>}
                  </div>
                )}
                {m.role === "user" && (
                  <div className="msg-actions"><button className="mini" onClick={() => editResend(i)}>Edit</button></div>
                )}
              </div>
            ))}
            {live && (
              <div className="row sam">
                <div className="who">SAM</div>
                {live.trace.length > 0 && <ProgressTracker steps={live.trace} answering={!!live.text} />}
                {live.text
                  ? <div className="bubble md" dangerouslySetInnerHTML={{ __html: renderMarkdown(live.text) }} />
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
        {started && !atBottom && <button className="scroll-btn" onClick={() => msgEnd.current?.scrollIntoView({ behavior: "smooth" })} aria-label="Scroll to latest">↓</button>}
      </main>

      <footer className="composer">
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
        <div className="composer-inner">
          <input ref={fileRef} type="file" multiple accept="image/*,.txt,.md,.csv,.json,.js,.ts,.log,.html,.css,.pdf" style={{ display: "none" }} onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          <button className="plus" onClick={() => fileRef.current?.click()} title="Add files or photos" aria-label="Add attachment">+</button>
          <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Message SAM…  (try /help)" rows={1} />
          <button className={`mic ${listening ? "on" : ""}`} onClick={toggleVoice} title="Speak your message" aria-label="Voice input">🎤</button>
          <button className={`mic ${speakReplies ? "on" : ""}`} onClick={() => setSpeakReplies((v) => !v)} title={speakReplies ? "SAM talks back — on" : "Have SAM talk back"} aria-label="Speak replies">{speakReplies ? "🔊" : "🔇"}</button>
          {loading
            ? <button className="send stop" onClick={stop} aria-label="Stop">■</button>
            : <button className="send" onClick={() => send()} disabled={!input.trim() && attachments.length === 0} aria-label="Send">↑</button>}
        </div>
        <div className="hint">SAM is private &amp; runs free on your computer · it asks before doing anything risky</div>
      </footer>

      {historyOpen && (
        <div className="drawer-wrap left" onClick={() => setHistoryOpen(false)}>
          <aside className="drawer drawer-l" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div><div className="drawer-title">Chats</div><div className="drawer-sub">Your conversations, saved on this computer.</div></div>
              <button className="icon-btn" onClick={() => { newChat(); setHistoryOpen(false); }} title="New chat">＋</button>
            </div>
            <ul className="convo-list">
              {convos.map((c) => (
                <li key={c.id} className={c.id === activeId ? "active" : ""}>
                  <button className="convo-open" onClick={() => openConvo(c.id)}>{c.title || "New chat"}</button>
                  <button className="convo-del" onClick={() => deleteConvo(c.id)} aria-label="Delete">✕</button>
                </li>
              ))}
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

      {voiceMode && <VoiceMode name={profile.name} ask={voiceAsk} onClose={() => setVoiceMode(false)} />}
      {adminOpen && <Admin onClose={() => setAdminOpen(false)} />}
      {dashOpen && <Dashboard onClose={() => setDashOpen(false)} />}

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
