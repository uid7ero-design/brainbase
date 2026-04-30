// ── Waste Operations Intelligence ─────────────────────────────────────────────
// Mock data for the HLNA waste command centre.
// Replace each field with a real API call as data becomes available.

export type Urgency = 'critical' | 'high' | 'medium' | 'low';
export type Impact  = 'high' | 'medium' | 'low';

export interface MetricPill {
  label: string;
  value: string;
  delta: string;
  up:    boolean;   // true = bad for contamination/cost, depends on context
  bad:   boolean;   // true = colour red/amber, false = colour green
}

export interface StructuredBriefing {
  urgency:      Urgency;
  title:        string;
  changed:      string;
  why:          string;
  risk:         string;
  action:       string;
  urgentCount:  number;
  timestamp:    string;
  metrics:      MetricPill[];
}

export interface WasteAction {
  id:          string;
  title:       string;
  description: string;
  impact:      Impact;
  urgency:     Impact;
  effort:      Impact;
  command:     string;
  cta:         string;
}

export interface WasteCommand {
  icon:    string;
  label:   string;
  command: string;
}

// ── Mock briefing ──────────────────────────────────────────────────────────────
export const WASTE_MOCK_BRIEFING: StructuredBriefing = {
  urgency:     'high',
  title:       'Operations Briefing',
  urgentCount: 3,
  timestamp:   new Date().toISOString(),
  metrics: [
    { label: 'Contamination', value: '18.4%', delta: '+3.1%', up: true,  bad: true  },
    { label: 'Missed Bins',   value: '22',    delta: '+22',   up: true,  bad: true  },
    { label: 'Diversion',     value: '51.8%', delta: '−2.4%', up: false, bad: true  },
    { label: 'Cost/Tonne',    value: '$182',  delta: '+$4',   up: true,  bad: true  },
  ],
  changed:
    'Contamination rate has risen to 18.4% across 6 suburbs — up 3.1% from last week. ' +
    'Missed bin services in the north-west corridor increased by 22. ' +
    'Landfill diversion rate has dropped below the 52% compliance threshold.',
  why:
    'Wet weather this week degraded bin presentation quality across multiple routes. ' +
    'Seasonal contamination patterns are emerging, consistent with Q3 FY2023 data. ' +
    'North-west route timing changes introduced last fortnight may be contributing to missed services.',
  risk:
    'Contractor penalty clauses activate above 20% contamination — current rate is 18.4% with an upward trend. ' +
    'Estimated financial exposure: $18,400–$42,000 depending on audit outcome. ' +
    'Diversion rate at 51.8% risks quarterly compliance reporting breach.',
  action:
    'Prioritise suburb-level contamination audit for the top 6 affected areas immediately. ' +
    'Review north-west route logs for missed-bin root cause. ' +
    'Prepare resident education campaign targeting high-contamination zones before next collection cycle.',
};

// ── Mock recommended actions ───────────────────────────────────────────────────
export const WASTE_MOCK_ACTIONS: WasteAction[] = [
  {
    id:          'suburbs',
    title:       'Target top 10 affected suburbs',
    description: 'Prioritise areas above contamination threshold for immediate intervention',
    impact:      'high',
    urgency:     'high',
    effort:      'medium',
    cta:         'Review',
    command:     'Show me the top 10 suburbs above contamination threshold with recommended interventions for each',
  },
  {
    id:          'penalty',
    title:       'Estimate contract penalty exposure',
    description: 'Model financial impact if current contamination trend continues through next audit',
    impact:      'high',
    urgency:     'high',
    effort:      'low',
    cta:         'Analyse',
    command:     'Calculate estimated contractor penalty exposure if current contamination rates continue. Show financial impact scenarios.',
  },
  {
    id:          'education',
    title:       'Prepare resident education campaign',
    description: 'Generate suburb-specific messaging targeting contamination hotspots',
    impact:      'medium',
    urgency:     'medium',
    effort:      'medium',
    cta:         'Draft',
    command:     'Draft a suburb-specific resident education campaign for our top contamination hotspots. Include key messages and recommended channels.',
  },
  {
    id:          'missed',
    title:       'Investigate missed-bin clusters',
    description: 'Identify route and timing patterns behind north-west corridor exceptions',
    impact:      'medium',
    urgency:     'high',
    effort:      'low',
    cta:         'Investigate',
    command:     'Analyse missed bin clusters in the north-west corridor. Show route patterns, timing issues and recommended corrective actions.',
  },
];

// ── Command chip suggestions ───────────────────────────────────────────────────
export const WASTE_COMMANDS: WasteCommand[] = [
  {
    icon:    '📊',
    label:   'Summarise performance',
    command: 'Summarise today\'s waste and recycling performance across all service streams',
  },
  {
    icon:    '🗺️',
    label:   'Show suburbs above threshold',
    command: 'Show all suburbs currently above the contamination threshold with a suburb-by-suburb breakdown',
  },
  {
    icon:    '💰',
    label:   'Explain cost impact',
    command: 'Explain the financial impact of current contamination levels and what it means for our contractor agreements',
  },
  {
    icon:    '📝',
    label:   'Draft action plan',
    command: 'Draft a 5-point operational action plan to address the current contamination and missed-bin issues',
  },
  {
    icon:    '📈',
    label:   'Compare to last week',
    command: 'Compare this week\'s waste performance against last week. Highlight what changed and why it matters',
  },
  {
    icon:    '⚠️',
    label:   'Forecast landfill cost',
    command: 'Forecast landfill cost exposure for the next quarter based on current diversion trends',
  },
];

// ── System health status (right sidebar) ──────────────────────────────────────
export const SYSTEM_HEALTH = [
  { id: 'data-scan',  label: 'Data Scan',       status: 'active',   statusLabel: 'Running',   color: '#34D399' },
  { id: 'briefing',   label: 'Briefing Engine',  status: 'active',   statusLabel: 'Live',      color: '#A78BFA' },
  { id: 'thresholds', label: 'Alert Monitor',    status: 'warning',  statusLabel: '3 Alerts',  color: '#FB7185' },
  { id: 'reports',    label: 'Report Queue',     status: 'pending',  statusLabel: 'Pending',   color: '#FBBF24' },
];

// ── Active monitors (right sidebar) ───────────────────────────────────────────
export type MonitorStatus = 'stable' | 'rising' | 'falling' | 'breach';

export interface ActiveMonitor {
  id:     string;
  label:  string;
  value:  string;
  status: MonitorStatus;
  arrow:  string;
  bad:    boolean;
}

export interface WasteAlert {
  id:       string;
  label:    string;
  severity: 'high' | 'medium' | 'low';
  command:  string;
}

export const ACTIVE_MONITORS: ActiveMonitor[] = [
  { id: 'contamination', label: 'Contamination',  value: '18.4%', status: 'rising',  arrow: '↑', bad: true },
  { id: 'missed-bins',   label: 'Missed Bins',    value: '22',    status: 'breach',  arrow: '↑', bad: true },
  { id: 'cost',          label: 'Cost/Tonne',     value: '$182',  status: 'rising',  arrow: '↑', bad: true },
  { id: 'diversion',     label: 'Diversion Rate', value: '51.8%', status: 'falling', arrow: '↓', bad: true },
];

export const WASTE_ALERTS: WasteAlert[] = [
  {
    id:       'suburbs',
    label:    '6 suburbs above contamination threshold',
    severity: 'high',
    command:  'Show me the suburbs above contamination threshold with current rates and recommended interventions',
  },
  {
    id:       'missed',
    label:    '22 missed-bin clusters identified',
    severity: 'high',
    command:  'Analyse missed bin clusters in the north-west corridor. Show route patterns and corrective actions.',
  },
  {
    id:       'cost',
    label:    'Cost per tonne rising — +$4 this week',
    severity: 'medium',
    command:  'Explain the cost per tonne increase this week and forecast the impact for the quarter',
  },
];
