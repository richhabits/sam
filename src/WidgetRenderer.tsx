import React from "react";
import { renderMarkdown } from "./lib/md";

// ── WIDGET COMPONENTS ──

function ChartWidget({ data }: { data: any }) {
  // A sleek, minimal CSS-only bar chart
  const max = Math.max(...data.series.map((d: any) => d.value), 1);
  return (
    <div className="widget-chart">
      <div className="wc-title">{data.title}</div>
      <div className="wc-bars">
        {data.series.map((s: any, i: number) => (
          <div key={i} className="wc-bar-wrap">
            <div className="wc-bar-val">{s.value}</div>
            <div className="wc-bar" style={{ height: `${(s.value / max) * 100}%` }} />
            <div className="wc-bar-label">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KanbanWidget({ data }: { data: any }) {
  return (
    <div className="widget-kanban">
      <div className="wk-title">{data.title}</div>
      <div className="wk-board">
        {data.columns.map((col: any, i: number) => (
          <div key={i} className="wk-col">
            <div className="wk-col-head">{col.name} <span className="wk-count">{col.tasks.length}</span></div>
            <div className="wk-tasks">
              {col.tasks.map((t: string, j: number) => (
                <div key={j} className="wk-task">{t}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── WIDGET RENDERER ──

const WidgetRenderer = React.memo(function WidgetRenderer({ text, onFollowUp }: { text: string; onFollowUp?: (q: string) => void }) {
  if (!text) return null;

  // Split text by ```widget blocks
  const segments = text.split("```widget\n");
  
  // Custom Markdown renderer to turn [ ] and [x] into beautiful checkboxes
  const renderWithCheckboxes = (raw: string) => {
    let html = renderMarkdown(raw);
    // Replace markdown checkboxes with styled spans
    html = html.replace(/<li>\[ \] (.*?)<\/li>/g, '<li class="check-item"><span class="check-box"></span><span class="check-text">$1</span></li>');
    html = html.replace(/<li>\[x\] (.*?)<\/li>/gi, '<li class="check-item done"><span class="check-box checked">✓</span><span class="check-text">$1</span></li>');
    return html;
  };

  if (segments.length === 1) {
    return <div className="bubble md" dangerouslySetInnerHTML={{ __html: renderWithCheckboxes(text) }} />;
  }

  const out = [];
  if (segments[0].trim()) {
    out.push(<div key="t0" className="bubble md" dangerouslySetInnerHTML={{ __html: renderWithCheckboxes(segments[0]) }} />);
  }

  for (let i = 1; i < segments.length; i++) {
    const split = segments[i].split("\n```");
    const widgetJson = split[0];
    const remainingText = split.slice(1).join("\n```");

    try {
      const w = JSON.parse(widgetJson);
      if (w.type === "chart") {
        out.push(<ChartWidget key={`w${i}`} data={w} />);
      } else if (w.type === "kanban") {
        out.push(<KanbanWidget key={`w${i}`} data={w} />);
      } else if (w.type === "followup" && onFollowUp) {
        out.push(
          <div key={`w${i}`} className="widget-followup">
            {w.questions.map((q: string, j: number) => (
              <button key={j} className="wf-chip" onClick={() => onFollowUp(q)}>{q}</button>
            ))}
          </div>
        );
      } else {
        out.push(<div key={`w${i}`} className="widget-error">Unknown widget type: {w.type}</div>);
      }
    } catch (_e) {
      out.push(<div key={`w${i}`} className="bubble md" dangerouslySetInnerHTML={{ __html: renderWithCheckboxes(`\`\`\`json\n${widgetJson}\n\`\`\``) }} />);
    }

    if (remainingText?.trim()) {
      out.push(<div key={`t${i}`} className="bubble md" dangerouslySetInnerHTML={{ __html: renderWithCheckboxes(remainingText) }} />);
    }
  }

  return <div className="widget-feed">{out}</div>;
});

export default WidgetRenderer;
