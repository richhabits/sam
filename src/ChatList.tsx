import Icon from "./Icon";
import { Fragment, useMemo, useState } from "react";
import { cleanTitle, groupByRecency, matchesQuery, snippetFor } from "./lib/chatTitle";

/**
 * The sidebar chat list: search, recency grouping, pin/rename/delete.
 *
 * Extracted from App.tsx so the list can grow without bloating a 1800-line file that
 * several people edit at once. Everything here is presentational + local UI state; all
 * mutations go back up through the callbacks so App stays the single owner of `convos`.
 */

/** Structurally compatible with App's `Convo` (which is not exported). */
export interface ChatItem {
  id: string;
  title: string;
  at: number;
  folder?: string;
  /** User-set name. Wins over the auto-derived `title`, which is recomputed on every turn. */
  name?: string;
  pinned?: boolean;
  messages: { text: string }[];
}

export interface ChatListProps {
  convos: ChatItem[];
  activeId: string;
  folders: string[];
  folderFilter: string;
  dragChat: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onTogglePin: (id: string) => void;
  onMoveToFolder: (id: string, folder: string) => void;
  setDragChat: (id: string) => void;
}

/** The label shown for a chat: an explicit user name, else a cleaned-up first message. */
export function displayTitle(c: ChatItem): string {
  if (c.name?.trim()) return c.name.trim();
  const cleaned = cleanTitle(c.title);
  // `title` is already the truncated first message; if it cleans to nothing, fall back to
  // the first user message body so an emoji-only opener still gets a usable label.
  if (cleaned) return cleaned;
  return cleanTitle(c.messages[0]?.text) || "New chat";
}

export default function ChatList({
  convos, activeId, folders, folderFilter, dragChat,
  onOpen, onDelete, onRename, onTogglePin, onMoveToFolder, setDragChat,
}: ChatListProps) {
  const [q, setQ] = useState("");
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState("");

  // Search covers message CONTENT, not just titles — finding a past conversation by
  // something said inside it is the whole point.
  const filtered = useMemo(() => {
    const inFolder = convos.filter((c) => !folderFilter || c.folder === folderFilter);
    if (!q.trim()) return inFolder;
    return inFolder.filter((c) => matchesQuery(q, displayTitle(c), c.messages.map((m) => m.text)));
  }, [convos, folderFilter, q]);

  const pinned = useMemo(
    () => filtered.filter((c) => c.pinned).sort((a, b) => b.at - a.at),
    [filtered],
  );
  // When searching, a flat relevance-free list is easier to scan than date headers.
  const groups = useMemo(() => {
    const rest = filtered.filter((c) => !c.pinned).sort((a, b) => b.at - a.at);
    if (q.trim()) return rest.length ? [{ label: "Results" as const, items: rest }] : [];
    return groupByRecency(rest);
  }, [filtered, q]);

  function startRename(c: ChatItem) {
    setEditing(c.id);
    setDraft(displayTitle(c));
  }
  function commitRename(id: string) {
    const v = draft.trim();
    // An emptied field clears the override and hands the title back to auto-derivation.
    onRename(id, v);
    setEditing("");
    setDraft("");
  }

  const row = (c: ChatItem) => (
    <li
      key={c.id}
      className={`${c.id === activeId ? "active" : ""} ${dragChat === c.id ? "dragging" : ""} ${c.pinned ? "pinned" : ""}`}
      draggable={editing !== c.id}
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", c.id); e.dataTransfer.effectAllowed = "move"; setDragChat(c.id); }}
      onDragEnd={() => setDragChat("")}
    >
      {editing === c.id ? (
        <input
          className="side-rename"
          // Focus + select on mount: the field only exists because Rename was just clicked,
          // and pre-selecting lets a full retype start immediately.
          ref={(el) => { el?.focus(); el?.select(); }}
          value={draft}
          aria-label="Chat name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => commitRename(c.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commitRename(c.id); }
            else if (e.key === "Escape") { e.preventDefault(); setEditing(""); setDraft(""); }
          }}
        />
      ) : (
        <button type="button" className="side-open" onClick={() => onOpen(c.id)} title={displayTitle(c)}>
          {c.pinned && <span className="side-pin-dot" aria-hidden="true"><Icon name="pin" size={13} /></span>}
          <span className="side-open-t">{displayTitle(c)}</span>
          {q.trim() && (() => {
            const s = snippetFor(q, c.messages.map((m) => m.text));
            return s ? <span className="side-snip">{s}</span> : null;
          })()}
        </button>
      )}
      {editing !== c.id && (
        <span className="side-acts">
          <button type="button" className={`side-act ${c.pinned ? "on" : ""}`} onClick={() => onTogglePin(c.id)}
            title={c.pinned ? "Unpin" : "Pin to top"} aria-label={c.pinned ? "Unpin chat" : "Pin chat"}><Icon name="pin" size={12} /></button>
          <button type="button" className="side-act" onClick={() => startRename(c)}
            title="Rename" aria-label="Rename chat"><Icon name="pencil" size={12} /></button>
          {folders.length > 0 && (
            <select className="side-move" value={c.folder || ""} onClick={(e) => e.stopPropagation()}
              onChange={(e) => onMoveToFolder(c.id, e.target.value)} title="Move to folder" aria-label="Move to folder">
              <option value="">No folder</option>
              {folders.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          )}
          <button type="button" className="side-act del" onClick={() => onDelete(c.id)}
            title="Delete" aria-label="Delete chat"><Icon name="close" size={12} /></button>
        </span>
      )}
    </li>
  );

  const empty = filtered.length === 0;

  return (
    <>
      <div className="side-search" style={{ margin: "4px 12px 10px", display: "flex", alignItems: "center", gap: 8, background: "#16181D", border: "1px solid #232730", borderRadius: "10px", padding: "7px 12px", height: 36, boxSizing: "border-box" }}>
        <span className="side-search-ic" aria-hidden="true" style={{ color: "#8A909D", display: "flex", alignItems: "center" }}><Icon name="search" size={14} /></span>
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search chats…" aria-label="Search chats" style={{ background: "transparent", border: "none", outline: "none", color: "#F3F4F6", fontSize: 13, width: "100%" }} />
        {q && <button type="button" className="side-search-x" onClick={() => setQ("")} aria-label="Clear search" style={{ background: "none", border: "none", color: "#8A909D", cursor: "pointer", display: "flex", alignItems: "center" }}><Icon name="close" size={12} /></button>}
      </div>
      <ul className="side-list">
        {pinned.length > 0 && !q.trim() && (
          <>
            <li className="side-group">Pinned</li>
            {pinned.map(row)}
          </>
        )}
        {q.trim() && pinned.map(row)}
        {groups.map((g) => (
          <Fragment key={g.label}>
            {/* One header per non-empty bucket; hidden when searching (single "Results" group). */}
            {!q.trim() && <li className="side-group">{g.label}</li>}
            {g.items.map(row)}
          </Fragment>
        ))}
        {empty && (
          <li className="side-empty">
            <div className="empty-state-ic"><Icon name="chat" size={24} /></div>
            <div className="empty-state-text">
              {q.trim() ? `No chats match “${q.trim()}”.`
                : folderFilter ? "This folder is empty."
                  : "It's quiet in here."}
            </div>
            {!q.trim() && !folderFilter && <div className="empty-state-sub">Type a message below to start your first conversation with SAM.</div>}
            {!q.trim() && folderFilter && <div className="empty-state-sub">Drag and drop chats here to organize your workspace.</div>}
          </li>
        )}
      </ul>
    </>
  );
}
