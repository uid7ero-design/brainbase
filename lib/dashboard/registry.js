export const DASHBOARDS = {
  fleet: {
    name: 'Fleet',
    route: '/dashboard/fleet',
    aliases: ['fleet', 'vehicles', 'vehicle fleet', 'fleet management', 'vehicle management'],
    context: `Fleet Management — tracks all municipal vehicles across departments (Waste Collection, Parks & Gardens, Roads & Drainage, Customer Service, Facilities). Data covers: cost breakdown per vehicle (wages, fuel, maintenance, rego, repairs, insurance, depreciation), servicing status (overdue / due soon / OK), driver hours and overtime, downtime events by category (breakdown, scheduled, accident, external), vehicle utilisation rates, trip logs with stops and areas visited, and co-location data. Data is uploaded via Excel file — ask if no data is loaded.`,
  },
  waste: {
    name: 'Waste',
    route: '/dashboard/waste',
    aliases: ['waste', 'waste collection', 'garbage', 'recycling', 'bins', 'bin collection', 'waste management'],
    context: `Waste Management — monitors collection across 10 geographic zones. Zone data: wages, fuel, maintenance, services, tonnage, households. Monthly cost trend vs budget vs prior year (Jul–Apr). Tonnage by type: waste ~1,440t, recycling ~700t, organics ~345t, hard waste ~105t (April figures). Contamination rates: Zone 8 Industrial 22.4% (highest, 12 education actions), Zone 3 Eastern 14.8%, Zone 9 Suburban 10.6%, Zone 1 Northern 8.2%, Zone 6 Coastal 6.1%. Cost accounts: Wages $90.7k (budget $88k), Fuel $145.8k (budget $140k), Maintenance $53.2k (budget $50k), Contract Services $17.4k, Disposal Levies $64.1k, Admin $13.8k. Sub-dashboards: bin lifts, budgeting, commodities, community, complaints, compliance, cost-per-household, diversion, fleet, green waste.`,
  },
  water: {
    name: 'Water',
    route: '/dashboard/water',
    aliases: ['water', 'water services', 'water supply', 'water management', 'water & sewer', 'sewer'],
    context: `Water Services — monitors water supply, treatment, and distribution operations including consumption trends, infrastructure condition, pressure zones, main breaks, and water quality compliance.`,
  },
  roads: {
    name: 'Roads',
    route: '/dashboard/roads',
    aliases: ['roads', 'road maintenance', 'roads and drainage', 'drainage', 'civil', 'infrastructure'],
    context: `Roads & Drainage — tracks road maintenance programs, pavement condition ratings, drainage works, pothole repairs, civil infrastructure costs, and SLA compliance for response times.`,
  },
  parks: {
    name: 'Parks',
    route: '/dashboard/parks',
    aliases: ['parks', 'parks and gardens', 'gardens', 'open spaces', 'green spaces', 'grounds'],
    context: `Parks & Gardens — covers open space maintenance, turf management, horticultural programs, playground safety inspections, irrigation, tree management, and grounds maintenance costs.`,
  },
  environment: {
    name: 'Environment',
    route: '/dashboard/environment',
    aliases: ['environment', 'environmental', 'carbon', 'sustainability', 'emissions', 'climate', 'energy'],
    context: `Environment & Sustainability — tracks carbon emissions across council operations, energy consumption, renewable energy generation, environmental compliance, waste diversion rates, and sustainability program outcomes.`,
  },
  labour: {
    name: 'Labour',
    route: '/dashboard/labour',
    aliases: ['labour', 'labor', 'workforce', 'staff', 'employees', 'hr', 'human resources', 'headcount'],
    context: `Labour Management — monitors workforce data including staff headcount by department, overtime hours, absenteeism rates, award compliance, leave balances, and total labour cost allocation.`,
  },
  facilities: {
    name: 'Facilities',
    route: '/dashboard/facilities',
    aliases: ['facilities', 'buildings', 'assets', 'facility management', 'building management', 'property'],
    context: `Facilities Management — tracks building maintenance, asset condition ratings, reactive and preventive work orders, facility operating costs, energy use per building, and lease/property management.`,
  },
  logistics: {
    name: 'Logistics',
    route: '/dashboard/logistics',
    aliases: ['logistics', 'supply chain', 'procurement', 'purchasing', 'deliveries'],
    context: `Logistics — covers procurement operations, supplier performance, purchase order status, delivery lead times, and supply chain cost management across council services.`,
  },
  supply: {
    name: 'Supply',
    route: '/dashboard/supply',
    aliases: ['supply', 'inventory', 'stock', 'stores', 'materials', 'stock management'],
    context: `Supply & Stores — manages inventory levels, stock movements, reorder points, supplier orders, and material cost tracking across council operations.`,
  },
  depot: {
    name: 'Depot',
    route: '/dashboard/depot',
    aliases: ['depot', 'depot operations', 'yard', 'workshop', 'vehicle yard'],
    context: `Depot Operations — monitors depot yard activity, vehicle check-ins and check-outs, equipment allocation, workshop throughput, and operational readiness of the council depot.`,
  },
  construction: {
    name: 'Construction',
    route: '/dashboard/construction',
    aliases: ['construction', 'capital works', 'projects', 'building works', 'capex', 'capital'],
    context: `Construction & Capital Works — tracks active capital works projects, construction costs vs budget, project milestones and completion status, contractor performance, and variation orders.`,
  },
};

const ALIAS_MAP = Object.fromEntries(
  Object.entries(DASHBOARDS).flatMap(([slug, d]) =>
    [...d.aliases, slug].map(a => [a.toLowerCase(), d.route])
  )
);

export function resolveRoute(target) {
  if (!target || target === 'none') return null;
  const t = target.toLowerCase().trim();
  if (ALIAS_MAP[t]) return ALIAS_MAP[t];
  // Partial/substring match as fallback
  const hit = Object.entries(DASHBOARDS).find(
    ([slug, d]) => t.includes(slug) || d.aliases.some(a => t.includes(a.toLowerCase()))
  );
  return hit ? hit[1].route : null;
}

export function getContextForPath(pathname) {
  if (!pathname) return '';
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'dashboard') return '';
  const slug = parts[1];
  if (!slug) return 'You are on the main Brainbase dashboard overview.';
  const d = DASHBOARDS[slug];
  if (!d) return `You are viewing the ${slug} dashboard.`;
  let ctx = `Current dashboard: ${d.name}\n${d.context}`;
  if (parts[2]) ctx += `\nCurrent sub-section: ${parts[2].replace(/-/g, ' ')}`;
  return ctx;
}

export function getDashboardList() {
  return Object.values(DASHBOARDS)
    .map(d => `${d.name} → ${d.route.replace('/dashboard/', '')}`)
    .join(', ');
}
