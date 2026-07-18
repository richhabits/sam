import Icon, { type IconName } from "../Icon";

// Turn a step label into text with any URL rendered as a compact source link.
function traceLine(t: string) {
  return t.split(/(https?:\/\/[^\s]+)/g).map((p, i) => {
    // biome-ignore lint/suspicious/noArrayIndexKey: text tokens split by URL regex; positional identity is correct
    if (/^https?:\/\//.test(p)) return <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="src-link">{p.replace(/^https?:\/\/(www\.)?/, "").slice(0, 44)}</a>;
    // biome-ignore lint/suspicious/noArrayIndexKey: text tokens split by URL regex; positional identity is correct
    return <span key={i}>{p}</span>;
  });
}

// A mini icon for each step SAM takes — so you can watch the A→X journey.
// Stroke glyphs, not emoji: at 13px the emoji were unreadable colour smudges that
// ignored the theme, and the dot they sit in can't tint clip-art with the accent.
const STEP_ICONS: [RegExp, IconName][] = [
  [/git ?hub|repo|issue|pull request|\bpr\b|commit|pushing|branch|git status/i, "branch"],
  [/your apps/i, "grid"], [/your socials/i, "people"],
  [/search|google|looking up/i, "search"], [/read/i, "book"],
  [/weather/i, "cloud"], [/location/i, "location"], [/time/i, "clock"],
  [/email|mail|gmail/i, "mail"], [/call|ring|facetime|phone/i, "phone"],
  [/message|imessage|text/i, "chat"], [/calendar|diary|event/i, "calendar"],
  [/remind|notif/i, "bell"],
  [/file|folder|desktop|spotlight/i, "folder"], [/screenshot|screen/i, "screen"],
  [/music|play|song|track/i, "music"], [/download/i, "download"],
  [/open|browser|url|website/i, "globe"], [/command|terminal|running/i, "terminal"],
  [/click|type|mouse|keyboard/i, "cursor"],
];
function stepIcon(a: string): IconName {
  for (const [re, ic] of STEP_ICONS) if (re.test(a)) return ic;
  return "settings";
}

// Uber-style live progress tracker: mini icons + a connecting line, the current
// step pulsing, everything before it ticked off. Shows the journey from A → X.
export function ProgressTracker({ steps, answering }: { steps: string[]; answering: boolean }) {
  const items = steps.map((s) => ({ icon: stepIcon(s), label: s.replace(/^✓\s*/, "") }));
  if (answering) items.push({ icon: "pencil" as IconName, label: "Writing" });
  return (
    <div className="tracker" role="status" aria-label="SAM progress">
      {items.map((it, i) => {
        const isLast = i === items.length - 1;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: render-only progress tracker; steps append in order
          <div key={i} className={`tstep ${isLast ? "active" : "done"}`}>
            <span className="tdot"><Icon name={it.icon} size={13} className="tico" /></span>
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
        // biome-ignore lint/suspicious/noArrayIndexKey: render-only completed journey; steps are in order
        <div key={j} className="tstep done">
          <span className="tdot"><Icon name={stepIcon(t)} size={13} className="tico" /></span>
          <span className="tlabel">{traceLine(t.replace(/^✓\s*/, ""))}</span>
        </div>
      ))}
    </div>
  );
}
