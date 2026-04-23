export const AGENTS = [
  { id: "scout", label: "Scout", role: "Research & pipeline", color: "#00CFEA",  status: "active",  last: "Scanned 14 leads · 2m ago",   tasks: 7 },
  { id: "flux",  label: "Flux",  role: "Digest & content",   color: "#A78BFA",  status: "idle",    last: "Digest sent to 12 · 18m ago",  tasks: 2 },
  { id: "relay", label: "Relay", role: "Comms & drafts",     color: "#34D399",  status: "active",  last: "3 drafts queued · 5m ago",     tasks: 5 },
  { id: "inbox", label: "Inbox", role: "Reply management",   color: "#FBBF24",  status: "standby", last: "4 replies pending · 1h ago",   tasks: 4 },
];

export const STAGE_CARDS = [
  { id: "scout", agent: "Scout", icon: "🔍", stat: "14 leads scanned",   detail: "3 qualified · 2m",    color: "#00CFEA", pos: { top: "18%", left: "3%" } },
  { id: "flux",  agent: "Flux",  icon: "⚡", stat: "Digest published",   detail: "12 recipients · 83%", color: "#A78BFA", pos: { top: "22%", right: "4%" } },
  { id: "relay", agent: "Relay", icon: "📡", stat: "3 drafts queued",    detail: "Pending approval",    color: "#34D399", pos: { bottom: "22%", left: "4%" } },
  { id: "inbox", agent: "Inbox", icon: "✉️", stat: "4 replies pending",  detail: "2 require review",    color: "#FBBF24", pos: { bottom: "18%", right: "3%" } },
];
