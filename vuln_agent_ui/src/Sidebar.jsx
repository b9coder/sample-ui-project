import { useState } from "react";

const USER_NAME = "Nilesh Jadhav";
const USER_EMAIL = "nileshyjadhav@gmail.com";

function initials(name) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNewChat,
}) {
  const [query, setQuery] = useState("");

  const filtered = conversations.filter((c) =>
    c.title.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <aside className="sidebar">
      <button className="new-chat-btn" onClick={onNewChat}>
        <span className="new-chat-icon">+</span> New conversation
      </button>

      <div className="sidebar-search">
        <input
          type="text"
          placeholder="Search conversations"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="conversation-list">
        {filtered.length === 0 && (
          <div className="conversation-empty">No conversations found</div>
        )}
        {filtered.map((c) => (
          <button
            key={c.id}
            className={`conversation-item ${c.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(c.id)}
            title={c.title}
          >
            {c.title}
          </button>
        ))}
      </div>

      <div className="sidebar-profile">
        <div className="profile-avatar">{initials(USER_NAME)}</div>
        <div className="profile-info">
          <div className="profile-name">{USER_NAME}</div>
          <div className="profile-email">{USER_EMAIL}</div>
        </div>
      </div>
    </aside>
  );
}
