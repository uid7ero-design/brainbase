export type HlnaModule = {
  key: string;
  name: string;
  industry: string;
  tables: string[];
  kpis: string[];
  vocabulary: string[];
  questions: string[];
  actions: string[];
};

export const HLNA_MODULES: Record<string, HlnaModule> = {
  waste_recycling: {
    key: 'waste_recycling',
    name: 'Waste & Recycling',
    industry: 'Local Government',
    tables: ['waste_records', 'service_requests'],
    kpis: ['tonnes', 'collections', 'contamination_rate', 'cost_per_tonne', 'missed_bins', 'diversion_rate'],
    vocabulary: ['contamination', 'collections', 'routes', 'suburbs', 'bins', 'landfill', 'organics', 'recycling', 'general waste', 'hard waste', 'tonnes', 'diversion'],
    questions: [
      'Summarise waste performance this week',
      'Which suburb has the highest contamination?',
      'Why are missed bins increasing?',
      'What should I focus on today?',
      'Compare this month to last month',
      'Which service type is driving cost increases?',
    ],
    actions: ['open_dashboard', 'highlight_metric', 'generate_report', 'upload_data', 'navigate'],
  },

  fleet_management: {
    key: 'fleet_management',
    name: 'Fleet Management',
    industry: 'Operations',
    tables: ['fleet_metrics'],
    kpis: ['fleet_availability', 'maintenance_cost', 'defects', 'cost_per_km', 'fuel_spend', 'services_due'],
    vocabulary: ['fleet', 'assets', 'maintenance', 'defects', 'availability', 'vehicles', 'trucks', 'vans', 'utes', 'km', 'fuel', 'repairs', 'depreciation', 'rego'],
    questions: [
      'Summarise fleet performance',
      'Which vehicles are driving cost increases?',
      'Why has availability dropped?',
      'What defects need attention?',
      'Show maintenance spend by vehicle type',
      'Which vehicles are overdue for servicing?',
    ],
    actions: ['open_dashboard', 'highlight_metric', 'generate_report', 'navigate'],
  },

  service_requests: {
    key: 'service_requests',
    name: 'Service Requests',
    industry: 'Customer Operations',
    tables: ['service_requests'],
    kpis: ['open_requests', 'resolution_rate', 'avg_days_open', 'high_priority_count', 'sla_compliance', 'backlog'],
    vocabulary: ['requests', 'tickets', 'SLA', 'resolution', 'backlog', 'priority', 'suburb', 'service type', 'closed', 'pending', 'open', 'days open'],
    questions: [
      'How many open requests do we have?',
      'What is the SLA compliance rate?',
      'Which suburb has the most open requests?',
      'Summarise service request performance',
      'What are the high priority items?',
      'Why is the backlog growing?',
    ],
    actions: ['open_dashboard', 'highlight_metric', 'generate_report', 'navigate'],
  },

  logistics_freight: {
    key: 'logistics_freight',
    name: 'Logistics & Freight',
    industry: 'Transport',
    tables: ['logistics_shipments'],
    kpis: ['on_time_delivery', 'cost_per_lane', 'route_efficiency', 'carrier_performance', 'delivery_delays', 'shipment_volume'],
    vocabulary: ['shipments', 'routes', 'carriers', 'delivery', 'lanes', 'freight', 'on-time', 'delays', 'depot', 'transit', 'pickup', 'drop-off'],
    questions: [
      'Which route is underperforming?',
      'Why are delivery delays increasing?',
      'Summarise logistics performance',
      'Which carrier has the highest cost variance?',
      'Compare on-time delivery across routes',
      'What is our freight spend this month?',
    ],
    actions: ['open_dashboard', 'highlight_metric', 'generate_report', 'navigate'],
  },

  utilities: {
    key: 'utilities',
    name: 'Utilities',
    industry: 'Infrastructure',
    tables: ['utilities_incidents'],
    kpis: ['fault_count', 'response_time', 'asset_uptime', 'water_consumption', 'energy_usage', 'repair_cost'],
    vocabulary: ['faults', 'outages', 'assets', 'infrastructure', 'water', 'energy', 'response', 'repair', 'maintenance', 'uptime', 'incidents', 'network'],
    questions: [
      'Summarise utility faults this week',
      'Which assets have the most incidents?',
      'What is our average fault response time?',
      'Are water consumption trends normal?',
      'Show energy usage compared to last month',
      'Which areas have the most outages?',
    ],
    actions: ['open_dashboard', 'highlight_metric', 'generate_report', 'navigate'],
  },

  construction: {
    key: 'construction',
    name: 'Construction',
    industry: 'Project Delivery',
    tables: ['construction_projects'],
    kpis: ['projects_on_track', 'budget_variance', 'milestone_completion', 'contractor_performance', 'defect_rate', 'days_behind'],
    vocabulary: ['projects', 'budget', 'milestones', 'contractors', 'defects', 'schedule', 'completion', 'variation', 'handover', 'site', 'scope', 'cost'],
    questions: [
      'Which projects are behind schedule?',
      'Summarise project portfolio status',
      'What is the total budget variance?',
      'Which contractors are underperforming?',
      'Show milestone completion rates',
      'What are the highest-risk projects?',
    ],
    actions: ['open_dashboard', 'highlight_metric', 'generate_report', 'navigate'],
  },

  wste: {
    key: 'wste',
    name: 'WSTe',
    industry: 'Local Government',
    tables: ['wste_runs', 'wste_vehicles', 'wste_gps_points', 'wste_waste_tickets', 'wste_exceptions', 'wste_service_verifications', 'wste_service_events', 'wste_assets', 'wste_planned_services', 'wste_evidence_items'],
    kpis: ['gps_points', 'vehicles_tracked', 'runs_analysed', 'tickets_matched', 'exceptions_count', 'verification_rate', 'completion_pct'],
    vocabulary: ['GPS', 'route', 'run', 'truck pass', 'service verification', 'ticket match', 'exception', 'missed service', 'GPS gap', 'address lookup', 'vehicle', 'depot', 'driver', 'completion rate', 'suburb', 'bin lift', 'RFID', 'FOGO', 'organics', 'recycling', 'hard waste', 'street sweeping', 'bin maintenance', 'evidence', 'confidence score'],
    questions: [
      'How many exceptions are open today?',
      'Which vehicle has the most missed services?',
      'Verify service for this address',
      'Summarise service verification performance this week',
      'Which suburb has the highest exception rate?',
      'Are all routes completing above 95%?',
      'What evidence exists for this property?',
    ],
    actions: ['open_dashboard', 'highlight_metric', 'generate_report', 'navigate', 'address_lookup'],
  },
};

export function getModule(key: string): HlnaModule | null {
  return HLNA_MODULES[key] ?? null;
}

export function buildModuleContext(moduleKey: string): string {
  const mod = HLNA_MODULES[moduleKey];
  if (!mod) return '';
  return `[Active Module: ${mod.name}]
Industry: ${mod.industry}
Primary KPIs: ${mod.kpis.join(', ')}
Available data tables: ${mod.tables.join(', ')}
Domain vocabulary: ${mod.vocabulary.join(', ')}
Suggested questions the user might ask: ${mod.questions.map(q => `"${q}"`).join('; ')}

Adapt all responses to use ${mod.name} terminology. When the user asks vague questions like "why is this increasing?" or "what should I focus on?", interpret them in the context of ${mod.name} operations.`;
}

export const ALL_MODULE_KEYS = Object.keys(HLNA_MODULES);
