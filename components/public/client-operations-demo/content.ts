// /client-operations/demo copy — carried over verbatim from the previous
// app/client-operations/demo/page.tsx. Only presentation fields (per-item
// hex colours) were dropped in the visual-system conversion.

export const DASHBOARD_TABS = ['Leads', 'Clients', 'Bookings', 'Requests', 'Activity'];

export const KPI_CARDS = [
  { label: "Today's Bookings", value: '6', sub: 'Scheduled today' },
  { label: 'New Leads', value: '6', sub: 'Last 7 days' },
  { label: 'Follow-ups', value: '5', sub: 'Awaiting action' },
  { label: 'Open Leads', value: '7', sub: 'New or contacted' },
];

export const TODAY_SCHEDULE = [
  { name: 'Client Appointment', detail: '09:00–10:00 · Main Office' },
  { name: 'Group Program', detail: '14:30–15:30 · Studio A' },
  { name: 'Private Session', detail: '17:00–18:00 · Online' },
];

export const ATTENTION = [
  { name: 'New website enquiry', status: 'Never contacted', type: 'Lead' },
  { name: 'Existing client', status: 'Follow-up due', type: 'Client' },
  { name: 'Service enquiry', status: 'Awaiting response', type: 'Lead' },
];

export const SESSIONS = [
  {
    day: 'Mon 24',
    title: 'Client Appointment',
    program: 'Initial Consultation',
    time: '09:00–10:00',
    venue: 'Main Office',
    capacity: '1/1',
  },
  {
    day: 'Mon 24',
    title: 'Group Program',
    program: 'Weekly Session',
    time: '14:30–15:30',
    venue: 'Studio A',
    capacity: '8/12',
  },
  {
    day: 'Wed 26',
    title: 'Client Session',
    program: 'Ongoing Service',
    time: '11:00–12:00',
    venue: 'Online',
    capacity: '1/1',
  },
  {
    day: 'Thu 27',
    title: 'Workshop',
    program: 'Client Program',
    time: '17:00–18:00',
    venue: 'Location B',
    capacity: '9/16',
  },
];

export const FLOW = [
  {
    number: '01',
    title: 'Enquiry arrives',
    body: 'Website, referral and other enquiries enter the same client operations system.',
  },
  {
    number: '02',
    title: 'Lead becomes visible',
    body: 'The business can immediately see who is new, contacted or awaiting follow-up.',
  },
  {
    number: '03',
    title: 'Client is organised',
    body: 'Contact details, relationship status and activity stay connected around one client record.',
  },
  {
    number: '04',
    title: 'Service is scheduled',
    body: 'Appointments, sessions, programs, locations and capacity are managed inside the same system.',
  },
  {
    number: '05',
    title: 'Follow-up stays visible',
    body: 'Calls, emails, requests and outstanding actions remain visible until resolved.',
  },
  {
    number: '06',
    title: 'HLNΛ adds context',
    body: 'The intelligence layer surfaces priorities, activity and operational signals across the business.',
  },
];

export const MODULES = [
  { title: 'Leads', body: 'See new enquiries, status and follow-up requirements.' },
  { title: 'Clients', body: 'Keep contacts, records and relationship activity organised.' },
  { title: 'Scheduling', body: 'Manage appointments, sessions, programs, locations and capacity.' },
  { title: 'Requests', body: 'Keep incoming work and outstanding actions visible.' },
  { title: 'Dashboards', body: 'Bring the most important operational indicators into one view.' },
  { title: 'HLNΛ', body: 'Provide intelligence and context across the connected platform.' },
];

export const DEPLOYMENT_INCLUDES = [
  'Website enquiry capture',
  'Lead and enquiry management',
  'Client records',
  'Session scheduling',
  'Follow-up actions',
  'Operational dashboard',
  'HLNΛ intelligence layer',
];
