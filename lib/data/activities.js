export const PANEL_SECTIONS = [
  { label: "INBOX REPLIES",   type: "reply",     color: "#FBBF24" },
  { label: "DATA SCAN",       type: "data_scan", color: "#00CFEA" },
  { label: "WEEKLY DIGEST",   type: "digest",    color: "#A78BFA" },
  { label: "QUEUE",           type: "queue",     color: "#34D399" },
];

export const INIT_ITEMS = [
  { id: 1, type: "reply",     title: "Reply to investor deck",   sub: "Sent via Queue · 9min",     time: "9m" },
  { id: 2, type: "data_scan", title: "Intelligence report ready", sub: "3 items flagged",           time: "18m" },
  { id: 3, type: "digest",    title: "Weekly digest published",  sub: "12 recipients · 83% open",  time: "1h" },
  { id: 4, type: "queue",     title: "Board deck draft ready",   sub: "2 slides need your review", time: "2h" },
];
