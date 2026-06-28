import { useMemo, useState } from "react";
import type { Conversation } from "./api";

export function Sidebar({
  conversations,
  activeId,
  collapsed,
  onToggleCollapse,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  conversations: Conversation[];
  activeId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter((c) => c.name.toLowerCase().includes(q));
  }, [conversations, query]);

  function startEditing(c: Conversation) {
    setEditingId(c.id);
    setEditingName(c.name);
  }

  function commitEditing() {
    if (editingId && editingName.trim()) {
      onRename(editingId, editingName.trim());
    }
    setEditingId(null);
  }

  if (collapsed) {
    return (
      <div className="sidebar collapsed">
        <button className="sidebar-toggle" onClick={onToggleCollapse} title="Expand sidebar">
          »
        </button>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <button className="sidebar-toggle" onClick={onToggleCollapse} title="Collapse sidebar">
          «
        </button>
      </div>

      <button className="sidebar-new-btn" onClick={onCreate}>
        + New conversation
      </button>

      <input
        className="sidebar-search"
        placeholder="Search conversations"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      <div className="sidebar-list">
        {filtered.map((c) => (
          <div
            key={c.id}
            className={`sidebar-item ${c.id === activeId ? "active" : ""}`}
            onClick={() => editingId !== c.id && onSelect(c.id)}
          >
            {editingId === c.id ? (
              <input
                className="sidebar-item-edit"
                value={editingName}
                autoFocus
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={commitEditing}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEditing();
                  if (e.key === "Escape") setEditingId(null);
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span className="sidebar-item-name">{c.name}</span>
                <div className="sidebar-item-actions">
                  <button
                    className="sidebar-item-action"
                    title="Rename"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEditing(c);
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="sidebar-item-action"
                    title="Delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`Delete "${c.name}"?`)) onDelete(c.id);
                    }}
                  >
                    🗑
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
        {filtered.length === 0 && <div className="sidebar-empty">No conversations found</div>}
      </div>

      <div className="sidebar-user">
        <div className="sidebar-user-avatar">NJ</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">Nilesh Jadhav</div>
          <div className="sidebar-user-email">nileshyjadhav@gmail.com</div>
        </div>
      </div>
    </div>
  );
}
