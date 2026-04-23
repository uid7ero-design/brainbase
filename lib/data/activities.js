export const PANEL_SECTIONS = [
  { label: "INBOX REPLIES", type: "reply", color: "#FBBF24" },
  { label: "SCOUT TASKS",   type: "scout", color: "#00CFEA" },
  { label: "FLUX TASKS",    type: "flux",  color: "#A78BFA" },
  { label: "RELAY DRAFTS",  type: "relay", color: "#34D399" },
];

export const INIT_ITEMS = [
  { id: 1, type: "reply", title: "Reply to investor deck",   sub: "Sent by Scout · 9min",      time: "9m" },
  { id: 2, type: "scout", title: "Pipeline report compiled", sub: "3 deals flagged at risk",    time: "18m" },
  { id: 3, type: "flux",  title: "Weekly digest published",  sub: "12 recipients · 83% open",  time: "1h" },
  { id: 4, type: "relay", title: "Board deck draft ready",   sub: "2 slides need your review",  time: "2h" },
];
