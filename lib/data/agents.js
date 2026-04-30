// Waste operations intelligence agents — replace with live API data as available

export const AGENTS = [
  {
    id:     "waste-scan",
    label:  "Waste Data Scan",
    role:   "Contamination & collections analysis",
    color:  "#34D399",
    status: "active",
    last:   "3 months data analysed · 2m ago",
    tasks:  4,
  },
  {
    id:     "briefing",
    label:  "Briefing Engine",
    role:   "Operations intelligence & alerts",
    color:  "#A78BFA",
    status: "active",
    last:   "Briefing generated · just now",
    tasks:  2,
  },
  {
    id:     "thresholds",
    label:  "Threshold Monitor",
    role:   "KPI alerts & escalations",
    color:  "#FB7185",
    status: "active",
    last:   "3 thresholds breached · 5m ago",
    tasks:  3,
  },
  {
    id:     "reports",
    label:  "Report Scheduler",
    role:   "Scheduled exports & digests",
    color:  "#FBBF24",
    status: "standby",
    last:   "Next: weekly digest · Mon 8am",
    tasks:  1,
  },
];

export const STAGE_CARDS = [
  { id: "waste-scan",  agent: "Waste Data Scan",   icon: "🔍", stat: "3 months analysed",      detail: "4 items flagged · 2m",     color: "#34D399", pos: { top: "18%", left: "3%" } },
  { id: "briefing",    agent: "Briefing Engine",    icon: "⚡", stat: "Briefing live",           detail: "3 urgent · just now",      color: "#A78BFA", pos: { top: "22%", right: "4%" } },
  { id: "thresholds",  agent: "Threshold Monitor",  icon: "▲",  stat: "3 thresholds breached",  detail: "Contamination · Fleet",    color: "#FB7185", pos: { bottom: "22%", left: "4%" } },
  { id: "reports",     agent: "Report Scheduler",   icon: "📋", stat: "Report pending",          detail: "Weekly digest · Mon 8am",  color: "#FBBF24", pos: { bottom: "18%", right: "3%" } },
];
