

// Turn a step label into text with any URL rendered as a compact source link.
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
export function ProgressTracker({ steps, answering }: { steps: string[]; answering: boolean }) {
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
export function TraceStrip({ steps }: { steps: string[] }) {
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
