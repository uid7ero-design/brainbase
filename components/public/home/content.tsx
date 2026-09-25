import type { ReactNode } from 'react';

// Homepage copy — carried over verbatim from the previous app/page.tsx.
// Presentation-only fields (per-item rainbow colours) were dropped in the
// visual redesign; every title, description and link is unchanged.

export const PROOF_POINTS = ['Start with what you need', 'Connect existing systems', 'Expand when ready'];

export const STAT_STRIP: [string, string][] = [
  ['One platform', 'Connected operations'],
  ['HLNΛ', 'Intelligence layer'],
  ['Configurable', 'Built around your operation'],
  ['Expandable', 'Add more when you need it'],
];

export const PROBLEM_TOOLS = [
  'Website & forms',
  'Email',
  'Spreadsheets',
  'Calendars',
  'CRM',
  'Reporting',
  'Specialist systems',
];

export const SOLUTION_OUTCOMES = [
  {
    title: 'One operational view',
    body: 'Bring disconnected information, systems and workflows into one environment.',
  },
  {
    title: 'Less manual admin',
    body: 'Reduce repetitive work, duplicated entry and time spent moving between tools.',
  },
  {
    title: 'Faster decisions',
    body: 'Surface the information that matters without manually searching across systems.',
  },
  {
    title: 'Better visibility',
    body: 'Understand activity, performance and priorities from a clearer operational picture.',
  },
];

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const CAPABILITIES: { title: string; description: string; icon: ReactNode }[] = [
  {
    title: 'Clients & CRM',
    description: 'Contacts, pipelines, communication history and client activity in one connected workspace.',
    icon: (
      <Icon>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </Icon>
    ),
  },
  {
    title: 'Leads',
    description: 'Capture enquiries and follow them through to a client without losing track of where things stand.',
    icon: (
      <Icon>
        <path d="M4 4h16l-6 8v7l-4 2v-9z" />
      </Icon>
    ),
  },
  {
    title: 'Scheduling & Bookings',
    description: 'Manage appointments, sessions, programs and capacity with less manual coordination.',
    icon: (
      <Icon>
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <line x1="16" y1="2" x2="16" y2="6" />
        <line x1="8" y1="2" x2="8" y2="6" />
        <line x1="3" y1="10" x2="21" y2="10" />
      </Icon>
    ),
  },
  {
    title: 'Workflow Automation',
    description: 'Reduce repetitive admin with connected processes, triggers and follow-up workflows.',
    icon: (
      <Icon>
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </Icon>
    ),
  },
  {
    title: 'Dashboards & Reporting',
    description: 'Operational KPIs, trends and reporting brought together in a clear visual layer.',
    icon: (
      <Icon>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </Icon>
    ),
  },
  {
    title: 'Web Systems',
    description: 'Websites that capture enquiries and connect directly into your wider operational environment.',
    icon: (
      <Icon>
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </Icon>
    ),
  },
  {
    title: 'HLNΛ Intelligence',
    description: 'Ask questions and surface what matters across your connected operation.',
    icon: (
      <Icon>
        <path d="M12 3v6M12 15v6M3 12h6M15 12h6" />
      </Icon>
    ),
  },
  {
    title: 'Events & Ticketing',
    description:
      'Publish events with multiple free and paid ticket types, manage registrations, and issue digital tickets with QR check-in. Stripe Connect settles payments directly to your own bank account.',
    icon: (
      <Icon>
        <path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
        <path d="M13 5v14" strokeDasharray="2 2" />
      </Icon>
    ),
  },
];

export const CONFIG_EXAMPLES = [
  { title: 'Tennis organisation', items: ['Courts', 'Coaching sessions', 'Players', 'Capacity'] },
  { title: 'Consultancy', items: ['Consultations', 'Appointment durations', 'Intake questions', 'Teams meetings'] },
];

export const INTEGRATION_CAPABILITIES = ['Clients & CRM', 'Scheduling & Bookings', 'Dashboards & Reporting'];

export const HOW_STEPS = [
  {
    n: '01',
    title: 'Capture',
    body: 'Bring information in from enquiries, forms, bookings and the systems you already use.',
  },
  {
    n: '02',
    title: 'Organise',
    body: 'Turn that information into structured clients, leads, schedules and records.',
  },
  {
    n: '03',
    title: 'Operate',
    body: 'Run day-to-day work — follow-up, sessions, workflows and communication — in one place.',
  },
  {
    n: '04',
    title: 'Understand',
    body: 'Use dashboards and HLNΛ to see what needs attention.',
  },
];

export const INTELLIGENCE = [
  {
    title: 'Ask your operation',
    body: 'Use natural language to interrogate the information available inside BRΛINBΛSE.',
  },
  {
    title: 'Surface what matters',
    body: 'HLNΛ helps identify important activity, changes and operational signals.',
  },
  {
    title: 'Connected context',
    body: 'Bring information from across the platform together around the question being asked.',
  },
  {
    title: 'Move toward action',
    body: 'Use intelligence to help navigate priorities, workflows and decisions.',
  },
];

export const PROOF_FLOW: [string, string][] = [
  ['Website enquiries', 'leads'],
  ['Leads', 'organised clients'],
  ['Clients', 'scheduled sessions'],
  ['Activity', 'operational dashboard'],
];

export const STARTING_POINTS = [
  {
    eyebrow: 'Client Operations',
    title: 'Run clients, bookings and follow-up in one place.',
    body: 'A BRΛINBΛSE configuration for client-based businesses — leads, clients, bookings and follow-up in one connected environment.',
    href: '/client-operations',
    action: 'Explore Client Operations',
    number: '01',
  },
  {
    eyebrow: 'Web Systems',
    title: 'Turn your website into part of the operation.',
    body: 'Start with the customer-facing website and connect the operation behind it — enquiries, CRM, workflows and reporting.',
    href: '/web-systems',
    action: 'Explore Web Systems',
    number: '02',
  },
  {
    eyebrow: 'Platform Demo',
    title: 'See the wider BRΛINBΛSE platform in action.',
    body: 'Explore an interactive example showing how connected information, workflows, dashboards and HLNΛ come together.',
    href: '/demo',
    action: 'Explore the platform demo',
    number: '03',
  },
];
