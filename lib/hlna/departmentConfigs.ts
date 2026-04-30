import type { StructuredBriefing, WasteAction, ActiveMonitor, WasteAlert, WasteCommand } from './wasteIntelligence';
import {
  WASTE_MOCK_BRIEFING, WASTE_MOCK_ACTIONS,
  ACTIVE_MONITORS as WASTE_MONITORS, WASTE_ALERTS, WASTE_COMMANDS,
} from './wasteIntelligence';

export interface DepartmentConfig {
  key:      string;
  label:    string;
  briefing: StructuredBriefing;
  actions:  WasteAction[];
  monitors: ActiveMonitor[];
  alerts:   WasteAlert[];
  commands: WasteCommand[];
}

export const DEPARTMENT_LIST = [
  { key: 'waste',            label: 'Waste' },
  { key: 'fleet',            label: 'Fleet' },
  { key: 'parks',            label: 'Parks & Gardens' },
  { key: 'roads',            label: 'Roads' },
  { key: 'assets',           label: 'Assets' },
  { key: 'customer_service', label: 'Customer Service' },
  { key: 'compliance',       label: 'Compliance' },
  { key: 'planning',         label: 'Planning' },
  { key: 'finance',          label: 'Finance' },
  { key: 'facilities',       label: 'Facilities' },
  { key: 'it_digital',       label: 'IT / Digital' },
  { key: 'emergency',        label: 'Emergency / Incidents' },
];

const NOW = new Date().toISOString();

export const DEPARTMENT_CONFIGS: Record<string, DepartmentConfig> = {

  // ── Waste ──────────────────────────────────────────────────────────────────
  waste: {
    key: 'waste', label: 'Waste',
    briefing: WASTE_MOCK_BRIEFING,
    actions:  WASTE_MOCK_ACTIONS,
    monitors: WASTE_MONITORS,
    alerts:   WASTE_ALERTS,
    commands: WASTE_COMMANDS,
  },

  // ── Fleet ──────────────────────────────────────────────────────────────────
  fleet: {
    key: 'fleet', label: 'Fleet',
    briefing: {
      urgency: 'medium', title: 'Fleet Operations Briefing', urgentCount: 2, timestamp: NOW,
      metrics: [
        { label: 'Utilisation',    value: '78%',   delta: '-4%',   up: false, bad: true },
        { label: 'Downtime',       value: '3.2%',  delta: '+1.1%', up: true,  bad: true },
        { label: 'Fuel Cost',      value: '$4.2k', delta: '+$0.3k',up: true,  bad: true },
        { label: 'Maint Backlog',  value: '12',    delta: '+3',    up: true,  bad: true },
      ],
      changed: 'Vehicle utilisation has dropped to 78% — down 4% from last month. Maintenance backlog has grown to 12 units including 3 overdue for scheduled service. Fuel cost per kilometre is up 7%.',
      why: 'Two heavy vehicles were taken offline for unscheduled repairs, reducing fleet capacity. Fuel cost increase correlates with route inefficiencies from the north-west depot.',
      risk: 'Three vehicles overdue for service elevate unplanned downtime risk. Fuel overspend is tracking $0.3k above monthly budget with no corrective action yet taken.',
      action: 'Schedule the 3 overdue vehicles for immediate service. Review north-west depot routing. Escalate 2 heavy assets at replacement risk to capital planning.',
    },
    actions: [
      { id: 'overdue', title: 'Service overdue vehicles', description: 'Schedule immediate maintenance for 3 vehicles past their service interval', impact: 'high', urgency: 'high', effort: 'low', cta: 'Schedule', command: 'Show me the 3 vehicles overdue for service with mileage, last service date, and recommended action.' },
      { id: 'fuel',    title: 'Investigate fuel cost increase', description: 'Analyse north-west depot route data to find fuel inefficiencies', impact: 'medium', urgency: 'medium', effort: 'medium', cta: 'Analyse', command: 'Analyse fuel consumption at the north-west depot and identify routes or drivers contributing to the cost increase.' },
      { id: 'replace', title: 'Review replacement risk assets', description: 'Assess 2 heavy assets against lifecycle replacement model', impact: 'high', urgency: 'medium', effort: 'medium', cta: 'Review', command: 'Provide lifecycle analysis for the 2 heavy assets at replacement risk including remaining life and cost to replace vs repair.' },
      { id: 'util',    title: 'Improve fleet utilisation', description: 'Identify underutilised vehicles and scheduling optimisation opportunities', impact: 'medium', urgency: 'low', effort: 'high', cta: 'Optimise', command: 'Analyse fleet utilisation by vehicle type and identify opportunities to improve scheduling and recover the 4% utilisation drop.' },
    ],
    monitors: [
      { id: 'utilisation', label: 'Vehicle Utilisation', value: '78%',   status: 'falling', arrow: '↓', bad: true },
      { id: 'downtime',    label: 'Downtime Rate',       value: '3.2%',  status: 'rising',  arrow: '↑', bad: true },
      { id: 'fuel',        label: 'Fuel Cost/km',        value: '+7%',   status: 'rising',  arrow: '↑', bad: true },
      { id: 'backlog',     label: 'Maint Backlog',       value: '12',    status: 'rising',  arrow: '↑', bad: true },
    ],
    alerts: [
      { id: 'overdue', label: '3 vehicles overdue for scheduled service', severity: 'high', command: 'Show the 3 vehicles overdue for service with details and recommended scheduling.' },
      { id: 'fuel',    label: 'Fuel cost tracking $0.3k over monthly budget', severity: 'medium', command: 'Explain the fuel cost overrun and which routes or drivers are contributing most.' },
      { id: 'replace', label: '2 heavy assets at replacement risk', severity: 'medium', command: 'Provide lifecycle analysis for the 2 heavy assets at replacement risk with cost scenarios.' },
    ],
    commands: [
      { icon: '🚛', label: 'Summarise fleet status',    command: "Summarise today's fleet operations including utilisation, maintenance, and cost metrics" },
      { icon: '🔧', label: 'Show overdue vehicles',      command: 'Show all vehicles currently overdue for maintenance with details and recommended actions' },
      { icon: '⛽', label: 'Explain fuel cost rise',     command: 'Explain the fuel cost increase this period and identify the main contributing factors' },
      { icon: '📋', label: 'Draft maintenance plan',    command: 'Draft a 2-week maintenance schedule for all overdue vehicles prioritised by urgency' },
      { icon: '📈', label: 'Compare to last month',     command: "Compare this month's fleet performance against last month. Highlight what changed and why." },
      { icon: '⚠️', label: 'Forecast replacement cost', command: 'Forecast capital replacement cost for assets flagged at risk over the next 3 years' },
    ],
  },

  // ── Parks & Gardens ────────────────────────────────────────────────────────
  parks: {
    key: 'parks', label: 'Parks & Gardens',
    briefing: {
      urgency: 'medium', title: 'Parks & Gardens Briefing', urgentCount: 2, timestamp: NOW,
      metrics: [
        { label: 'Mowing Compliance', value: '82%', delta: '-6%',  up: false, bad: true },
        { label: 'Maint Backlog',     value: '47',  delta: '+12',  up: true,  bad: true },
        { label: 'Tree Requests',     value: '23',  delta: '+5',   up: true,  bad: true },
        { label: 'SLA Risk',          value: '14%', delta: '+3%',  up: true,  bad: true },
      ],
      changed: 'Mowing compliance has dropped to 82% — 4 parks are below minimum SLA frequency. Maintenance backlog has grown by 12 items. Tree service requests have reached 23, the highest since summer.',
      why: 'Wet weather has accelerated grass growth beyond standard cycle capacity. Backlog growth is driven by storm damage clearance and deferred preventive maintenance.',
      risk: '4 parks below SLA risk community complaints and breach notices. Three tree requests will breach the statutory response window within 14 days if not actioned.',
      action: 'Allocate additional mowing resources to the 4 SLA-at-risk parks. Prioritise the 3 tree requests approaching statutory deadline. Review backlog and defer low-priority items.',
    },
    actions: [
      { id: 'mowing',   title: 'Resolve SLA-at-risk parks',   description: 'Allocate additional mowing to 4 parks below minimum compliance frequency', impact: 'high', urgency: 'high', effort: 'medium', cta: 'Allocate', command: 'Show the 4 parks below mowing SLA with current vs required frequency and recommended resource allocation.' },
      { id: 'trees',    title: 'Clear urgent tree requests',   description: 'Prioritise 3 tree requests approaching statutory response deadline', impact: 'high', urgency: 'high', effort: 'low', cta: 'Prioritise', command: 'List tree service requests approaching deadline with location, type, and recommended action.' },
      { id: 'backlog',  title: 'Reduce maintenance backlog',  description: 'Categorise 47 backlog items and defer low-priority tasks to free capacity', impact: 'medium', urgency: 'medium', effort: 'medium', cta: 'Triage', command: 'Analyse the 47-item maintenance backlog and suggest which items to defer, delegate, and action this week.' },
      { id: 'capacity', title: 'Seasonal capacity planning',  description: 'Model crew requirements for peak mowing demand over the next 6 weeks', impact: 'medium', urgency: 'low', effort: 'high', cta: 'Plan', command: 'Model crew hours required to maintain full SLA compliance over the next 6 weeks given current grass growth rates.' },
    ],
    monitors: [
      { id: 'mowing',  label: 'Mowing Compliance', value: '82%', status: 'falling', arrow: '↓', bad: true },
      { id: 'backlog', label: 'Maint Backlog',      value: '47',  status: 'rising',  arrow: '↑', bad: true },
      { id: 'trees',   label: 'Tree Requests',      value: '23',  status: 'rising',  arrow: '↑', bad: true },
      { id: 'sla',     label: 'SLA Risk',           value: '14%', status: 'rising',  arrow: '↑', bad: true },
    ],
    alerts: [
      { id: 'mowing',  label: '4 parks below mowing SLA frequency', severity: 'high', command: 'Show the 4 parks below mowing SLA with frequency gaps and recommended allocation.' },
      { id: 'trees',   label: '3 tree requests approaching statutory deadline', severity: 'high', command: 'List tree requests approaching deadline with all details and urgency order.' },
      { id: 'backlog', label: 'Maintenance backlog grown by 12 items this week', severity: 'medium', command: 'Analyse the backlog growth and identify drivers and mitigation options.' },
    ],
    commands: [
      { icon: '🌿', label: 'Summarise parks performance', command: "Summarise today's parks and gardens performance including mowing compliance, backlog, and SLA status" },
      { icon: '📍', label: 'Show SLA-at-risk parks',       command: 'Show all parks below mowing SLA with location, frequency gap, and recommended action' },
      { icon: '🌳', label: 'Review tree requests',         command: 'List all open tree service requests sorted by urgency and statutory deadline' },
      { icon: '📋', label: 'Draft mowing schedule',        command: 'Draft an optimised mowing schedule for this week that resolves all SLA gaps' },
      { icon: '📈', label: 'Compare to last season',       command: 'Compare current parks performance to the same period last year with key differences' },
      { icon: '⚠️', label: 'Forecast backlog risk',        command: 'Forecast how the maintenance backlog will grow over the next 4 weeks without additional resources' },
    ],
  },

  // ── Roads ──────────────────────────────────────────────────────────────────
  roads: {
    key: 'roads', label: 'Roads',
    briefing: {
      urgency: 'high', title: 'Roads Operations Briefing', urgentCount: 3, timestamp: NOW,
      metrics: [
        { label: 'Open Defects',       value: '156',  delta: '+24', up: true,  bad: true },
        { label: 'Works Orders',       value: '34',   delta: '+8',  up: true,  bad: true },
        { label: 'Inspection Backlog', value: '21%',  delta: '+5%', up: true,  bad: true },
        { label: 'Contractor Perf.',   value: '88%',  delta: '-4%', up: false, bad: true },
      ],
      changed: 'Open road defects have increased to 156, up 24 since last week. Inspection backlog is at 21% overdue. Active works orders have grown to 34. Contractor performance has dropped to 88%.',
      why: 'Wet weather has accelerated surface deterioration. Inspection crew was reallocated to storm damage response. Contractor performance dip correlates with patching material supply delays.',
      risk: '12 Category 1 defects (immediate safety risk) create liability if not remediated within 24 hours. Contractor below 90% triggers SLA review clause in the current contract.',
      action: 'Immediately action 12 Category 1 defects. Escalate contractor performance to contract manager for SLA review. Reassign inspection crew to reduce overdue backlog.',
    },
    actions: [
      { id: 'cat1',       title: 'Action Category 1 defects',    description: 'Remediate 12 safety-critical road defects within the 24-hour liability window', impact: 'high', urgency: 'high', effort: 'medium', cta: 'Action', command: 'List all Category 1 road defects with location, type, age, and recommended remediation approach.' },
      { id: 'contractor', title: 'Escalate contractor performance', description: 'Initiate SLA review following contractor performance drop below 90%', impact: 'high', urgency: 'high', effort: 'low', cta: 'Escalate', command: 'Summarise contractor performance data and draft key points for the SLA review meeting.' },
      { id: 'inspections',title: 'Clear inspection backlog',      description: 'Reallocate crew to reduce the 21% overdue inspection rate this week', impact: 'medium', urgency: 'medium', effort: 'medium', cta: 'Plan', command: 'Develop a crew reallocation plan to clear the inspection backlog within 2 weeks.' },
      { id: 'hotspots',   title: 'Identify defect hotspot suburbs', description: 'Map defect clusters to target preventive treatment in high-frequency areas', impact: 'medium', urgency: 'low', effort: 'medium', cta: 'Analyse', command: 'Identify suburbs with the highest concentration of road defects and recommend preventive treatment priorities.' },
    ],
    monitors: [
      { id: 'defects',    label: 'Open Defects',       value: '156', status: 'breach',  arrow: '↑', bad: true },
      { id: 'works',      label: 'Works Orders',       value: '34',  status: 'rising',  arrow: '↑', bad: true },
      { id: 'inspection', label: 'Inspection Backlog', value: '21%', status: 'rising',  arrow: '↑', bad: true },
      { id: 'contractor', label: 'Contractor Perf.',   value: '88%', status: 'falling', arrow: '↓', bad: true },
    ],
    alerts: [
      { id: 'cat1',       label: '12 Category 1 defects — immediate safety liability', severity: 'high', command: 'List all Category 1 road defects with location, age, and required remediation timeline.' },
      { id: 'contractor', label: 'Contractor performance below SLA threshold (88%)', severity: 'high', command: 'Summarise contractor performance issues and draft points for the SLA review.' },
      { id: 'backlog',    label: 'Inspection backlog at 21% — growing trend', severity: 'medium', command: 'Analyse the inspection backlog and recommend a crew plan to clear it this week.' },
    ],
    commands: [
      { icon: '🛣️', label: 'Summarise roads status',     command: "Summarise today's roads operations including defects, works orders, inspections, and contractor performance" },
      { icon: '⚠️', label: 'Show Category 1 defects',    command: 'List all Category 1 road defects requiring immediate attention with location and recommended action' },
      { icon: '🔍', label: 'Map defect hotspots',         command: 'Map road defect clusters by suburb and identify highest-priority areas for preventive treatment' },
      { icon: '📋', label: 'Draft works programme',       command: 'Draft a 2-week works programme prioritising Category 1 defects and clearing the inspection backlog' },
      { icon: '📈', label: 'Compare to last quarter',     command: "Compare this quarter's roads performance against last quarter. Highlight trends and contributing factors." },
      { icon: '💰', label: 'Estimate liability exposure', command: 'Estimate liability exposure from unaddressed Category 1 defects based on current remediation timeline' },
    ],
  },

  // ── Assets ─────────────────────────────────────────────────────────────────
  assets: {
    key: 'assets', label: 'Assets',
    briefing: {
      urgency: 'medium', title: 'Asset Management Briefing', urgentCount: 2, timestamp: NOW,
      metrics: [
        { label: 'Asset Condition', value: '72%',   delta: '-3%',    up: false, bad: true },
        { label: 'Maint Backlog',   value: '$1.2M', delta: '+$180k', up: true,  bad: true },
        { label: 'Lifecycle Risk',  value: '18%',   delta: '+4%',    up: true,  bad: true },
        { label: 'Replace Risk',    value: '6',     delta: '+2',     up: true,  bad: true },
      ],
      changed: 'Asset condition index has fallen to 72%, with 6 assets flagged at replacement risk. Maintenance backlog has grown by $180k to $1.2M. Lifecycle risk has risen to 18% of total portfolio.',
      why: 'Three additional assets moved into the high lifecycle risk band following annual condition assessment. Backlog growth reflects deferred works from last quarter\'s budget freeze.',
      risk: 'Two of the 6 replacement-risk assets are critical infrastructure. Deferring replacement beyond 12 months significantly increases failure probability. Backlog at $1.2M exceeds the annual maintenance budget.',
      action: 'Progress capital approval for 2 critical replacement-risk assets. Triage the backlog for safety vs deferrable items. Update the asset management plan for council.',
    },
    actions: [
      { id: 'critical',  title: 'Approve critical replacements', description: 'Progress capital approval for 2 critical infrastructure assets at replacement risk', impact: 'high', urgency: 'high', effort: 'low', cta: 'Escalate', command: 'Provide a business case summary for the 2 critical assets at replacement risk including failure probability and cost.' },
      { id: 'backlog',   title: 'Triage maintenance backlog',   description: 'Categorise $1.2M backlog by safety, compliance, and deferability', impact: 'high', urgency: 'medium', effort: 'medium', cta: 'Triage', command: 'Analyse the $1.2M maintenance backlog and categorise items by safety risk, compliance requirement, and ability to defer.' },
      { id: 'lifecycle', title: 'Review lifecycle risk assets', description: 'Assess 4 non-critical assets in the high lifecycle risk band', impact: 'medium', urgency: 'medium', effort: 'medium', cta: 'Review', command: 'Review the 4 non-critical assets in the high lifecycle risk band with remaining life estimates and intervention options.' },
      { id: 'plan',      title: 'Update asset management plan', description: 'Refresh the council asset plan with current condition and risk data', impact: 'medium', urgency: 'low', effort: 'high', cta: 'Draft', command: 'Draft an update to the asset management plan reflecting current condition index, backlog, and replacement risk findings.' },
    ],
    monitors: [
      { id: 'condition', label: 'Asset Condition', value: '72%',   status: 'falling', arrow: '↓', bad: true },
      { id: 'backlog',   label: 'Maint Backlog',   value: '$1.2M', status: 'rising',  arrow: '↑', bad: true },
      { id: 'lifecycle', label: 'Lifecycle Risk',  value: '18%',   status: 'rising',  arrow: '↑', bad: true },
      { id: 'replace',   label: 'Replace Risk',    value: '6',     status: 'rising',  arrow: '↑', bad: true },
    ],
    alerts: [
      { id: 'critical',  label: '2 critical assets require immediate replacement decision', severity: 'high', command: 'Provide replacement risk analysis for the 2 critical infrastructure assets requiring capital approval.' },
      { id: 'backlog',   label: 'Maintenance backlog exceeds annual budget allocation', severity: 'high', command: 'Analyse the maintenance backlog vs budget and identify prioritisation options.' },
      { id: 'condition', label: 'Asset condition index declining — 3rd consecutive quarter', severity: 'medium', command: 'Analyse the trend in asset condition and identify the main contributing asset classes.' },
    ],
    commands: [
      { icon: '🏗️', label: 'Summarise asset status',       command: 'Summarise the current asset portfolio status including condition, backlog, and lifecycle risk' },
      { icon: '⚠️', label: 'Show replacement risks',        command: 'List all assets at replacement risk with condition, age, and estimated replacement cost' },
      { icon: '💰', label: 'Analyse backlog vs budget',     command: 'Compare the maintenance backlog against available budget and identify highest-priority items' },
      { icon: '📋', label: 'Draft asset plan update',       command: 'Draft a council briefing on asset condition, risks, and recommended capital and maintenance priorities' },
      { icon: '📈', label: 'Compare to last assessment',    command: 'Compare current asset condition to the last annual assessment and identify which classes declined most.' },
      { icon: '🔮', label: 'Forecast lifecycle costs',      command: 'Forecast total lifecycle costs for the asset portfolio over the next 10 years based on current condition trends' },
    ],
  },

  // ── Customer Service ───────────────────────────────────────────────────────
  customer_service: {
    key: 'customer_service', label: 'Customer Service',
    briefing: {
      urgency: 'medium', title: 'Customer Service Briefing', urgentCount: 2, timestamp: NOW,
      metrics: [
        { label: 'Open Requests', value: '284',     delta: '+45',   up: true,  bad: true },
        { label: 'Avg Response',  value: '3.2 days', delta: '+0.8d', up: true,  bad: true },
        { label: 'Repeat Issues', value: '38',      delta: '+12',   up: true,  bad: true },
        { label: 'Satisfaction',  value: '74%',     delta: '-5%',   up: false, bad: true },
      ],
      changed: 'Open service requests have grown to 284 — up 45 from last week. Average response time is 3.2 days, exceeding the 2-day target. Repeat issues are up 12. Satisfaction score has dropped to 74%.',
      why: 'The spike correlates with recent waste service disruptions and road defect reporting. Repeat issues suggest root causes are not being resolved on first contact.',
      risk: 'Satisfaction at 74% is approaching the council minimum threshold of 70% which triggers a performance review. Extended response times will amplify satisfaction decline if not addressed within 2 weeks.',
      action: 'Increase triage capacity to reduce backlog and restore response times. Investigate root causes of the top 5 repeat issue categories. Prepare a customer communications update.',
    },
    actions: [
      { id: 'backlog',      title: 'Clear request backlog',        description: 'Increase triage capacity to return response time to under 2 days', impact: 'high', urgency: 'high', effort: 'medium', cta: 'Plan', command: 'Analyse the 284 open requests by category and recommend a triage plan to restore response times to under 2 days.' },
      { id: 'repeat',       title: 'Resolve repeat issue causes',  description: 'Identify top repeat issue categories and their underlying service failures', impact: 'high', urgency: 'high', effort: 'medium', cta: 'Investigate', command: 'Identify the top 5 repeat issue categories in the past month and analyse the root cause pattern for each.' },
      { id: 'satisfaction', title: 'Improve satisfaction score',  description: 'Develop targeted improvements for the satisfaction drivers impacting the score', impact: 'medium', urgency: 'medium', effort: 'high', cta: 'Improve', command: 'Analyse customer satisfaction data and identify the top 3 drivers most impacting the 74% score.' },
      { id: 'comms',        title: 'Customer communications update', description: 'Draft a proactive update about current service volumes and timelines', impact: 'medium', urgency: 'low', effort: 'low', cta: 'Draft', command: "Draft a customer communications update explaining current service demand, expected response times, and what we're doing to improve." },
    ],
    monitors: [
      { id: 'requests', label: 'Open Requests',     value: '284',    status: 'breach',  arrow: '↑', bad: true },
      { id: 'response', label: 'Avg Response Time', value: '3.2d',   status: 'rising',  arrow: '↑', bad: true },
      { id: 'repeat',   label: 'Repeat Issues',     value: '38',     status: 'rising',  arrow: '↑', bad: true },
      { id: 'sat',      label: 'Satisfaction',      value: '74%',    status: 'falling', arrow: '↓', bad: true },
    ],
    alerts: [
      { id: 'backlog',  label: '284 open requests — backlog growing', severity: 'high', command: 'Analyse the open requests backlog by category and recommend a prioritisation plan.' },
      { id: 'response', label: 'Response time above 2-day target (3.2 days)', severity: 'high', command: 'Explain the response time degradation and recommend actions to get back to target.' },
      { id: 'sat',      label: 'Satisfaction declining — approaching review threshold', severity: 'medium', command: 'Analyse the satisfaction score drivers and identify the quickest wins to improve performance.' },
    ],
    commands: [
      { icon: '📞', label: 'Summarise service performance', command: "Summarise today's customer service performance including requests, response times, repeat issues, and satisfaction" },
      { icon: '📋', label: 'Show top complaint categories',  command: 'Show the top 5 customer complaint categories this week with volume and trend data' },
      { icon: '🔁', label: 'Analyse repeat issues',          command: 'Analyse repeat issues by property and service type to identify unresolved root causes' },
      { icon: '⚡', label: 'Draft triage plan',              command: 'Draft a triage plan to clear the open requests backlog and return response times to under 2 days' },
      { icon: '📈', label: 'Compare to last month',          command: "Compare this month's service performance against last month. Show trends and key differences." },
      { icon: '💬', label: 'Draft customer update',          command: 'Draft a customer communications update on current service levels and improvement actions' },
    ],
  },

  // ── Compliance ─────────────────────────────────────────────────────────────
  compliance: {
    key: 'compliance', label: 'Compliance',
    briefing: {
      urgency: 'high', title: 'Compliance Operations Briefing', urgentCount: 3, timestamp: NOW,
      metrics: [
        { label: 'Open Notices',     value: '42',  delta: '+8',  up: true,  bad: true },
        { label: 'Overdue Actions',  value: '15',  delta: '+4',  up: true,  bad: true },
        { label: 'Prosecutions',     value: '3',   delta: '0',   up: false, bad: false },
        { label: 'Compliance Score', value: '87%', delta: '-3%', up: false, bad: true },
      ],
      changed: 'Open compliance notices have grown to 42 with 15 actions now overdue. Compliance score has dropped to 87%. Three active prosecutions are progressing through the court process.',
      why: 'Notice backlog has accumulated due to officer capacity constraints and complex cases requiring legal review. Score decline reflects growing proportion of notices where initial response windows were not met.',
      risk: '15 overdue actions create potential legal liability if notices lapse. Score below 85% triggers council reporting requirements. Three active prosecutions require ongoing resource commitment.',
      action: 'Immediately review and action the 15 overdue items. Brief legal on 3 prosecution cases. Assess workload distribution and identify cases for delegation.',
    },
    actions: [
      { id: 'overdue',     title: 'Clear overdue compliance actions', description: 'Review and action all 15 overdue items before notice lapse deadlines', impact: 'high', urgency: 'high', effort: 'medium', cta: 'Action', command: 'List all 15 overdue compliance actions with deadline dates, case type, and recommended next steps.' },
      { id: 'prosecution', title: 'Review prosecution status',       description: 'Obtain status update on 3 active prosecutions and upcoming milestones', impact: 'high', urgency: 'high', effort: 'low', cta: 'Review', command: 'Summarise the status of the 3 active prosecutions including current stage and expected timeline.' },
      { id: 'backlog',     title: 'Reduce notice backlog',           description: 'Implement triage protocol to accelerate 42 open notices', impact: 'medium', urgency: 'medium', effort: 'medium', cta: 'Triage', command: 'Analyse the 42 open notices by domain and complexity and recommend a triage protocol to reduce the backlog.' },
      { id: 'capacity',    title: 'Review officer workload',         description: 'Assess compliance team capacity against current caseload', impact: 'medium', urgency: 'medium', effort: 'low', cta: 'Assess', command: 'Analyse officer workload distribution and identify cases suitable for delegation or streamlined processing.' },
    ],
    monitors: [
      { id: 'notices',  label: 'Open Notices',     value: '42',  status: 'rising',  arrow: '↑', bad: true },
      { id: 'overdue',  label: 'Overdue Actions',  value: '15',  status: 'breach',  arrow: '↑', bad: true },
      { id: 'prose',    label: 'Prosecutions',     value: '3',   status: 'stable',  arrow: '→', bad: false },
      { id: 'score',    label: 'Compliance Score', value: '87%', status: 'falling', arrow: '↓', bad: true },
    ],
    alerts: [
      { id: 'overdue',  label: '15 compliance actions overdue — lapse risk', severity: 'high', command: 'List all overdue compliance actions with deadline dates and recommended immediate steps.' },
      { id: 'prose',    label: '3 active prosecutions requiring management attention', severity: 'high', command: 'Summarise the 3 active prosecution cases with current status and upcoming milestones.' },
      { id: 'score',    label: 'Compliance score declining — 87% and dropping', severity: 'medium', command: 'Analyse the compliance score decline and identify the main domains contributing.' },
    ],
    commands: [
      { icon: '⚖️', label: 'Summarise compliance status',  command: "Summarise today's compliance operations including open notices, overdue actions, and compliance score" },
      { icon: '⚠️', label: 'Show overdue actions',          command: 'List all overdue compliance actions with deadlines, case types, and recommended next steps' },
      { icon: '🔍', label: 'Review prosecution cases',      command: 'Provide a status update on all active prosecutions including current stage and expected outcomes' },
      { icon: '📋', label: 'Draft action plan',             command: 'Draft an action plan to clear the overdue compliance backlog within 2 weeks' },
      { icon: '📈', label: 'Compare to last quarter',       command: "Compare this quarter's compliance performance against last. Identify trends and contributing factors." },
      { icon: '🎯', label: 'Forecast compliance risk',      command: 'Forecast compliance risk over the next quarter if current notice processing rates continue' },
    ],
  },

  // ── Planning ───────────────────────────────────────────────────────────────
  planning: {
    key: 'planning', label: 'Planning',
    briefing: {
      urgency: 'medium', title: 'Planning Services Briefing', urgentCount: 2, timestamp: NOW,
      metrics: [
        { label: 'Applications',    value: '127',     delta: '+18', up: true,  bad: false },
        { label: 'Avg Processing',  value: '42 days', delta: '+6d', up: true,  bad: true },
        { label: 'Overdue',         value: '23',      delta: '+7',  up: true,  bad: true },
        { label: 'Appeals',         value: '8',       delta: '+2',  up: true,  bad: true },
      ],
      changed: 'Active applications have grown to 127 with 23 now overdue beyond statutory timeframes. Average processing time is 42 days — above the 30-day target. Appeals have risen to 8, the highest in 6 months.',
      why: 'Application volume reflects seasonal development activity and a high proportion of complex applications requiring heritage, environmental, or traffic referrals.',
      risk: '23 overdue applications expose council to deemed refusal provisions. Rising appeals suggest decision quality or communication issues that could increase costs.',
      action: 'Immediately progress the 23 overdue applications. Analyse appeal trends for systemic quality issues. Consider temporary specialist resourcing for referral-heavy applications.',
    },
    actions: [
      { id: 'overdue',    title: 'Progress overdue applications', description: 'Act on all 23 overdue applications to prevent deemed refusal risk', impact: 'high', urgency: 'high', effort: 'medium', cta: 'Action', command: 'List all 23 overdue planning applications with age, type, status, and recommended immediate action.' },
      { id: 'appeals',    title: 'Analyse appeal trends',         description: 'Review 8 appeals to identify patterns in decision quality', impact: 'high', urgency: 'high', effort: 'medium', cta: 'Analyse', command: 'Analyse the 8 current planning appeals by application type, decision reason, and grounds of appeal to identify patterns.' },
      { id: 'processing', title: 'Reduce processing time',        description: 'Identify bottlenecks causing the 12-day delay beyond statutory timeframes', impact: 'medium', urgency: 'medium', effort: 'medium', cta: 'Investigate', command: 'Identify the main bottlenecks causing planning processing times to exceed the 30-day statutory target.' },
      { id: 'resources',  title: 'Assess resourcing options',     description: 'Model temporary resourcing to clear backlog and restore compliance', impact: 'medium', urgency: 'low', effort: 'medium', cta: 'Model', command: 'Model resourcing options to clear the planning backlog and return to under 30-day processing within 6 weeks.' },
    ],
    monitors: [
      { id: 'apps',       label: 'Active Applications', value: '127',     status: 'rising',  arrow: '↑', bad: false },
      { id: 'processing', label: 'Avg Processing',      value: '42 days', status: 'rising',  arrow: '↑', bad: true },
      { id: 'overdue',    label: 'Overdue',             value: '23',      status: 'breach',  arrow: '↑', bad: true },
      { id: 'appeals',    label: 'Active Appeals',      value: '8',       status: 'rising',  arrow: '↑', bad: true },
    ],
    alerts: [
      { id: 'overdue',    label: '23 applications overdue — deemed refusal risk', severity: 'high', command: 'List all overdue planning applications with age, type, and recommended immediate action.' },
      { id: 'appeals',    label: 'Appeals at 6-month high (8 active)', severity: 'high', command: 'Analyse the 8 active appeals to identify patterns in decision quality or process issues.' },
      { id: 'processing', label: 'Processing time at 42 days — 12 above target', severity: 'medium', command: 'Identify bottlenecks causing planning processing time overage and recommend solutions.' },
    ],
    commands: [
      { icon: '📋', label: 'Summarise planning pipeline',   command: 'Summarise the current planning applications pipeline including volumes, processing times, and overdue items' },
      { icon: '⚠️', label: 'Show overdue applications',     command: 'List all overdue planning applications with age, type, and recommended action for each' },
      { icon: '⚖️', label: 'Analyse appeals pattern',       command: 'Analyse current and recent planning appeals to identify systemic quality or process issues' },
      { icon: '📈', label: 'Model resourcing options',      command: 'Model the resourcing needed to restore planning processing to within statutory timeframes' },
      { icon: '📊', label: 'Compare to last quarter',       command: 'Compare current planning performance against last quarter with volume and processing time changes.' },
      { icon: '🔮', label: 'Forecast application volumes',  command: 'Forecast planning application volumes for the next quarter based on current trends' },
    ],
  },

  // ── Finance ────────────────────────────────────────────────────────────────
  finance: {
    key: 'finance', label: 'Finance',
    briefing: {
      urgency: 'medium', title: 'Financial Performance Briefing', urgentCount: 2, timestamp: NOW,
      metrics: [
        { label: 'Budget Variance',  value: '-$420k', delta: '-$120k', up: false, bad: true },
        { label: 'Revenue Collect.', value: '92%',    delta: '-2%',    up: false, bad: true },
        { label: 'Overdue Invoices', value: '38',     delta: '+12',    up: true,  bad: true },
        { label: 'Forecast Risk',    value: 'MEDIUM', delta: '↑',      up: true,  bad: true },
      ],
      changed: 'Year-to-date budget variance has widened to -$420k, driven by unforeseen capital expenditure. Revenue collection has dropped to 92% with 38 invoices now overdue. Year-end forecast risk has moved to medium.',
      why: 'Unplanned asset failures in Q2 required emergency capex not in the approved budget. Revenue decline reflects increased payment plan requests and 12 new overdue commercial accounts.',
      risk: 'If variance trajectory continues, year-end exposure could reach -$650k. Revenue shortfall risks are amplified by 38 overdue invoices totalling $124k. Finance committee review required within 2 weeks.',
      action: 'Prepare variance report for finance committee. Escalate top 10 overdue invoices for follow-up. Review Q3 capex for deferral opportunities.',
    },
    actions: [
      { id: 'variance', title: 'Prepare variance report',    description: 'Draft finance committee briefing with variance analysis and corrective actions', impact: 'high', urgency: 'high', effort: 'medium', cta: 'Draft', command: 'Draft a finance committee briefing on the -$420k budget variance including cause analysis, corrective actions, and revised year-end forecast.' },
      { id: 'invoices', title: 'Action overdue invoices',    description: 'Escalate top 10 overdue commercial invoices for direct follow-up', impact: 'high', urgency: 'high', effort: 'low', cta: 'Escalate', command: 'List the top 10 overdue invoices by value with account details, days overdue, and recommended escalation actions.' },
      { id: 'capex',    title: 'Review Q3 deferral options', description: 'Identify non-critical capital projects that could be deferred to reduce year-end risk', impact: 'medium', urgency: 'medium', effort: 'medium', cta: 'Analyse', command: 'Analyse the Q3 capital expenditure programme and identify items that could be deferred without operational impact.' },
      { id: 'revenue',  title: 'Revenue recovery plan',     description: 'Develop a plan to improve collection rates back to the 95% target', impact: 'medium', urgency: 'medium', effort: 'medium', cta: 'Plan', command: 'Develop a revenue recovery plan to improve collection from 92% to 95% target, including the approach for overdue accounts.' },
    ],
    monitors: [
      { id: 'variance', label: 'Budget Variance',    value: '-$420k', status: 'falling', arrow: '↓', bad: true },
      { id: 'revenue',  label: 'Revenue Collection', value: '92%',    status: 'falling', arrow: '↓', bad: true },
      { id: 'invoices', label: 'Overdue Invoices',   value: '38',     status: 'rising',  arrow: '↑', bad: true },
      { id: 'forecast', label: 'Year-end Risk',      value: 'MEDIUM', status: 'rising',  arrow: '↑', bad: true },
    ],
    alerts: [
      { id: 'variance', label: 'Budget variance at -$420k — committee review required', severity: 'high', command: 'Analyse the budget variance drivers and draft key points for the finance committee briefing.' },
      { id: 'invoices', label: '38 overdue invoices totalling ~$124k', severity: 'high', command: 'List overdue invoices sorted by value with account details and recommended collection actions.' },
      { id: 'forecast', label: 'Year-end risk elevated — potential -$650k exposure', severity: 'medium', command: 'Model the year-end financial exposure under different scenarios and recommend corrective actions.' },
    ],
    commands: [
      { icon: '💰', label: 'Summarise financial position', command: 'Summarise the current financial position including budget variance, revenue collection, and year-end forecast' },
      { icon: '📊', label: 'Analyse budget variance',      command: "Break down the -$420k budget variance by department and expenditure category with root cause analysis" },
      { icon: '📋', label: 'Draft committee briefing',     command: 'Draft a finance committee briefing on current variance, risks, and proposed corrective actions' },
      { icon: '🎯', label: 'Revenue recovery plan',        command: 'Develop a revenue recovery plan to get collection rates back to 95% target within this quarter' },
      { icon: '📈', label: 'Compare to last quarter',      command: "Compare this quarter's financial performance against last quarter and the approved budget." },
      { icon: '🔮', label: 'Forecast year-end position',   command: 'Forecast the year-end financial position under three scenarios: status quo, corrective actions, and optimistic.' },
    ],
  },

  // ── Facilities ─────────────────────────────────────────────────────────────
  facilities: {
    key: 'facilities', label: 'Facilities',
    briefing: {
      urgency: 'medium', title: 'Facilities Management Briefing', urgentCount: 2, timestamp: NOW,
      metrics: [
        { label: 'Open Work Orders', value: '68',     delta: '+14',  up: true, bad: true },
        { label: 'Avg Response',     value: '4.1 days', delta: '+1.2d', up: true, bad: true },
        { label: 'Energy Cost',      value: '$28k',   delta: '+$3k', up: true, bad: true },
        { label: 'Active Faults',    value: '22',     delta: '+7',   up: true, bad: true },
      ],
      changed: 'Open facilities work orders have grown to 68 with average response time rising to 4.1 days — above the 2-day SLA. Energy costs are $3k above budget this month. Active equipment faults have increased to 22.',
      why: 'Work order spike driven by end-of-winter HVAC maintenance that was deferred. Energy overrun correlates with higher heating loads. Equipment fault growth suggests ageing assets requiring more attention.',
      risk: 'Response time at 4.1 days has generated 6 formal complaints. Two HVAC faults in occupied council buildings require urgent attention to prevent occupancy impact.',
      action: 'Prioritise 2 urgent HVAC faults. Implement triage to bring response times below 2 days. Review energy usage across highest-consuming buildings.',
    },
    actions: [
      { id: 'hvac',     title: 'Resolve urgent HVAC faults',  description: 'Action 2 HVAC faults in occupied council buildings before occupancy impact', impact: 'high', urgency: 'high', effort: 'low', cta: 'Action', command: 'Provide details on the 2 urgent HVAC faults with building location, fault type, and recommended resolution.' },
      { id: 'response', title: 'Restore response time SLA',   description: 'Implement triage protocol to bring average response below the 2-day target', impact: 'high', urgency: 'high', effort: 'medium', cta: 'Plan', command: 'Analyse the 68 open work orders by priority and building, and recommend a triage plan to restore response to 2 days.' },
      { id: 'energy',   title: 'Reduce energy cost overrun',  description: 'Identify highest-consuming buildings and quick win efficiency measures', impact: 'medium', urgency: 'medium', effort: 'medium', cta: 'Analyse', command: 'Identify the top 5 highest-consuming council buildings this month and recommend quick win energy efficiency measures.' },
      { id: 'faults',   title: 'Audit equipment fault trends', description: 'Review 22 active faults to identify assets requiring preventive investment', impact: 'medium', urgency: 'medium', effort: 'medium', cta: 'Review', command: 'Analyse the 22 active equipment faults by asset type and age to identify assets needing preventive maintenance investment.' },
    ],
    monitors: [
      { id: 'workorders', label: 'Open Work Orders',  value: '68',    status: 'rising',  arrow: '↑', bad: true },
      { id: 'response',   label: 'Avg Response Time', value: '4.1d',  status: 'breach',  arrow: '↑', bad: true },
      { id: 'energy',     label: 'Energy Cost',       value: '$28k',  status: 'rising',  arrow: '↑', bad: true },
      { id: 'faults',     label: 'Active Faults',     value: '22',    status: 'rising',  arrow: '↑', bad: true },
    ],
    alerts: [
      { id: 'hvac',     label: '2 HVAC faults in occupied buildings — occupancy risk', severity: 'high', command: 'Provide details on the 2 urgent HVAC faults and recommended resolution approach.' },
      { id: 'response', label: 'Response time at 4.1 days — SLA breach', severity: 'high', command: 'Analyse the work order backlog and recommend actions to restore response time SLA.' },
      { id: 'energy',   label: 'Energy cost $3k over monthly budget', severity: 'medium', command: 'Identify buildings driving the energy cost overrun and recommend efficiency actions.' },
    ],
    commands: [
      { icon: '🏢', label: 'Summarise facilities status',    command: "Summarise today's facilities status including work orders, response times, energy, and faults" },
      { icon: '🔧', label: 'Show urgent faults',             command: 'List all active equipment faults sorted by urgency with building location and recommended action' },
      { icon: '⚡', label: 'Analyse energy cost overrun',    command: 'Identify the highest-consuming council buildings and recommend energy efficiency quick wins' },
      { icon: '📋', label: 'Draft maintenance schedule',     command: 'Draft a prioritised work order schedule for this week to restore response time SLA' },
      { icon: '📈', label: 'Compare to last month',          command: "Compare this month's facilities performance against last month with cost and response time changes." },
      { icon: '🔮', label: 'Forecast energy budget risk',    command: 'Forecast year-end energy spend based on current consumption and identify budget risk' },
    ],
  },

  // ── IT / Digital ───────────────────────────────────────────────────────────
  it_digital: {
    key: 'it_digital', label: 'IT / Digital',
    briefing: {
      urgency: 'high', title: 'IT & Digital Systems Briefing', urgentCount: 3, timestamp: NOW,
      metrics: [
        { label: 'Open Incidents',  value: '34',    delta: '+8',    up: true,  bad: true },
        { label: 'System Uptime',   value: '99.2%', delta: '-0.3%', up: false, bad: true },
        { label: 'Open Tickets',    value: '127',   delta: '+22',   up: true,  bad: true },
        { label: 'Security Alerts', value: '4',     delta: '+2',    up: true,  bad: true },
      ],
      changed: 'Open IT incidents have grown to 34 with 4 active security alerts requiring investigation. System uptime has dropped to 99.2% — below the 99.5% SLA. Helpdesk ticket queue has grown by 22 to 127 items.',
      why: 'Two security alerts relate to anomalous authentication activity. Uptime reduction correlates with a maintenance window that ran longer than scheduled. Ticket queue growth reflects month-end financial system processing issues.',
      risk: 'Two of the 4 security alerts are flagged as potentially related to external probing — requiring immediate assessment. Uptime below 99.5% for a second consecutive week activates the SLA credit clause.',
      action: 'Escalate 2 high-priority security alerts for immediate investigation. Engage managed services on the uptime SLA breach. Triage tickets for any security or service-impacting items.',
    },
    actions: [
      { id: 'security', title: 'Investigate security alerts', description: 'Escalate 2 high-priority security alerts for immediate security team assessment', impact: 'high', urgency: 'high', effort: 'low', cta: 'Escalate', command: 'Provide details on the 4 active security alerts, particularly the 2 high-priority ones, with recommended investigation steps.' },
      { id: 'uptime',   title: 'Address SLA uptime breach',  description: 'Engage managed services provider on the uptime SLA breach and credit clause', impact: 'high', urgency: 'high', effort: 'low', cta: 'Engage', command: 'Summarise uptime performance for the past 30 days and draft key points for the managed services SLA discussion.' },
      { id: 'tickets',  title: 'Triage helpdesk queue',      description: 'Identify and fast-track security or service-impacting tickets in the 127-item queue', impact: 'medium', urgency: 'high', effort: 'medium', cta: 'Triage', command: 'Analyse the helpdesk ticket queue and identify items requiring priority or security-related attention.' },
      { id: 'capacity', title: 'Review helpdesk capacity',   description: 'Assess whether current ticket volumes exceed team capacity', impact: 'medium', urgency: 'medium', effort: 'low', cta: 'Assess', command: 'Assess current helpdesk capacity against ticket volumes and recommend actions to prevent further backlog growth.' },
    ],
    monitors: [
      { id: 'incidents', label: 'Open Incidents',   value: '34',    status: 'rising',  arrow: '↑', bad: true },
      { id: 'uptime',    label: 'System Uptime',    value: '99.2%', status: 'falling', arrow: '↓', bad: true },
      { id: 'tickets',   label: 'Open Tickets',     value: '127',   status: 'rising',  arrow: '↑', bad: true },
      { id: 'security',  label: 'Security Alerts',  value: '4',     status: 'breach',  arrow: '↑', bad: true },
    ],
    alerts: [
      { id: 'security', label: '4 active security alerts — 2 high priority', severity: 'high', command: 'Provide details on the active security alerts, particularly the 2 high-priority ones, and recommended actions.' },
      { id: 'uptime',   label: 'System uptime below 99.5% SLA — 2nd consecutive week', severity: 'high', command: 'Summarise the uptime breach and draft points for the managed services SLA discussion.' },
      { id: 'tickets',  label: 'Helpdesk queue at 127 — growing', severity: 'medium', command: 'Analyse the helpdesk ticket queue for security or service-impacting items requiring priority action.' },
    ],
    commands: [
      { icon: '💻', label: 'Summarise IT status',        command: "Summarise today's IT and digital systems status including incidents, uptime, tickets, and security alerts" },
      { icon: '🔒', label: 'Review security alerts',     command: 'Provide details on all active security alerts with severity assessment and recommended investigation steps' },
      { icon: '📊', label: 'Analyse uptime performance', command: 'Analyse system uptime performance for the past 30 days and assess the SLA breach implications' },
      { icon: '🎫', label: 'Triage helpdesk queue',      command: 'Triage the helpdesk ticket queue and identify items requiring priority or security-related attention' },
      { icon: '📈', label: 'Compare to last month',      command: "Compare this month's IT performance against last month. Highlight incident, uptime, and security trends." },
      { icon: '🔮', label: 'Forecast risk exposure',     command: 'Forecast IT risk exposure based on current incident and security alert trends over the next 30 days' },
    ],
  },

  // ── Emergency / Incidents ──────────────────────────────────────────────────
  emergency: {
    key: 'emergency', label: 'Emergency / Incidents',
    briefing: {
      urgency: 'critical', title: 'Emergency & Incidents Briefing', urgentCount: 4, timestamp: NOW,
      metrics: [
        { label: 'Active Incidents', value: '3',       delta: '+1',    up: true,  bad: true },
        { label: 'Response Time',    value: '8.2 min', delta: '+1.1m', up: true,  bad: true },
        { label: 'Open Actions',     value: '27',      delta: '+8',    up: true,  bad: true },
        { label: 'Resources Avail.', value: '85%',     delta: '-8%',   up: false, bad: true },
      ],
      changed: 'Three active incidents in progress — one major (industrial spill, north precinct) and two minor (traffic signal outages). Response time has risen to 8.2 minutes. Open actions have grown by 8 to 27.',
      why: 'The industrial spill has required sustained multi-agency response, reducing available resources for other activations. Traffic signal outages are caused by a stormwater drainage issue affecting electrical conduits.',
      risk: 'Resource availability at 85% means a further incident could stretch capacity significantly. Four open actions are time-critical and must be completed within the next 4 hours.',
      action: 'Maintain incident commander for the major spill. Immediately action the 4 time-critical open items. Brief the CEO on major incident status. Activate resource contingency if availability drops below 80%.',
    },
    actions: [
      { id: 'major',    title: 'Manage major spill incident',    description: 'Maintain active incident command for industrial spill, north precinct', impact: 'high', urgency: 'high', effort: 'high', cta: 'Manage', command: 'Provide a current status update on the major industrial spill incident including completed and outstanding actions.' },
      { id: 'timecrit', title: 'Complete time-critical actions', description: 'Immediately progress 4 open actions with 4-hour deadlines', impact: 'high', urgency: 'high', effort: 'medium', cta: 'Action', command: 'List the 4 time-critical open actions with deadlines, current status, and responsible officers.' },
      { id: 'resources',title: 'Activate resource contingency', description: 'Prepare contingency resourcing in case availability drops below 80%', impact: 'high', urgency: 'high', effort: 'low', cta: 'Prepare', command: 'Summarise the resource contingency options available if emergency management capacity drops below 80%.' },
      { id: 'brief',    title: 'Prepare CEO briefing',          description: 'Draft an executive briefing on major incident status and council response', impact: 'medium', urgency: 'high', effort: 'low', cta: 'Draft', command: 'Draft an executive briefing for the CEO on the major incident, council response, and current status.' },
    ],
    monitors: [
      { id: 'incidents', label: 'Active Incidents', value: '3',       status: 'breach',  arrow: '↑', bad: true },
      { id: 'response',  label: 'Response Time',    value: '8.2 min', status: 'rising',  arrow: '↑', bad: true },
      { id: 'actions',   label: 'Open Actions',     value: '27',      status: 'rising',  arrow: '↑', bad: true },
      { id: 'resources', label: 'Resource Avail.',  value: '85%',     status: 'falling', arrow: '↓', bad: true },
    ],
    alerts: [
      { id: 'major',    label: 'Major incident active — industrial spill, north precinct', severity: 'high', command: 'Provide a full status update on the major industrial spill including current actions and outstanding items.' },
      { id: 'timecrit', label: '4 time-critical actions — 4-hour window', severity: 'high', command: 'List the 4 time-critical open actions with deadlines and current status.' },
      { id: 'resources',label: 'Resource availability at 85% — contingency threshold approaching', severity: 'medium', command: 'Summarise resource availability and outline contingency options if capacity drops further.' },
    ],
    commands: [
      { icon: '🚨', label: 'Summarise incident status',    command: 'Provide a full status update on all active incidents including completed and outstanding actions' },
      { icon: '⚡', label: 'Action critical items',        command: 'List all time-critical open actions with deadlines, responsible officers, and current status' },
      { icon: '👥', label: 'Check resource availability',  command: 'Summarise current emergency management resource availability and contingency options' },
      { icon: '📄', label: 'Draft CEO briefing',           command: 'Draft an executive briefing for the CEO on the major incident status, council response, and next steps' },
      { icon: '📞', label: 'Multi-agency coordination',    command: 'Summarise the multi-agency coordination status for the active major incident' },
      { icon: '📋', label: 'Post-incident action plan',    command: 'Draft a post-incident action plan for the major incident covering investigation, remediation, and lessons learned' },
    ],
  },
};

export function getDeptConfig(key: string): DepartmentConfig {
  return DEPARTMENT_CONFIGS[key] ?? DEPARTMENT_CONFIGS['waste'];
}
