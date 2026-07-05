import { useState } from "react";
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

export default function WidgetRenderer({ text }: { text: string }) {
  if (!text) return null;

  // Split text by ```widget blocks
  const segments = text.split("```widget\n");
  
  if (segments.length === 1) {
    return <div className="bubble md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
  }

  const out = [];
  // The first segment is always raw text before the first widget
  if (segments[0].trim()) {
    out.push(<div key="t0" className="bubble md" dangerouslySetInnerHTML={{ __html: renderMarkdown(segments[0]) }} />);
  }

  for (let i = 1; i < segments.length; i++) {
    const split = segments[i].split("\n```");
    const widgetJson = split[0];
    const remainingText = split.slice(1).join("\n```"); // In case of nested/multiple backticks

    try {
      const w = JSON.parse(widgetJson);
      if (w.type === "chart") {
        out.push(<ChartWidget key={`w${i}`} data={w} />);
      } else if (w.type === "kanban") {
        out.push(<KanbanWidget key={`w${i}`} data={w} />);
      } else {
        out.push(<div key={`w${i}`} className="widget-error">Unknown widget type: {w.type}</div>);
      }
    } catch (e) {
      // If parsing fails, just render it as a code block
      out.push(<div key={`w${i}`} className="bubble md" dangerouslySetInnerHTML={{ __html: renderMarkdown(`\`\`\`json\n${widgetJson}\n\`\`\``) }} />);
    }

    if (remainingText && remainingText.trim()) {
      out.push(<div key={`t${i}`} className="bubble md" dangerouslySetInnerHTML={{ __html: renderMarkdown(remainingText) }} />);
    }
  }

  return <div className="widget-feed">{out}</div>;
}
