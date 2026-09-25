// /web-systems copy — carried over verbatim from the previous
// app/web-systems/page.tsx. Presentation-only fields (per-item rainbow
// colours) were dropped in the visual redesign; every title, description,
// tag and action label is unchanged.

export const HERO_POINTS = ['Custom built', 'Connected systems', 'Managed infrastructure'];

export const PROBLEM_POINTS = [
  'Enquiries land in email',
  'Manual form admin',
  'Info copied elsewhere',
  'Bookings in another system',
  'Disconnected reporting',
  'Staff bridge the gaps',
];

export const SERVICES = [
  {
    title: 'Customer-Facing Website',
    description:
      'A modern site built around your business, your customers and the actions you want visitors to take.',
    tags: ['Business websites', 'Landing pages', 'Responsive design', 'Custom development'],
  },
  {
    title: 'Lead Capture & Automation',
    description:
      'Turn website enquiries into organised leads with automated routing, follow-up and clear visibility from the moment someone gets in touch.',
    tags: ['Smart forms', 'Lead routing', 'Follow-up', 'Notifications'],
  },
  {
    title: 'Business Integrations',
    description:
      'Connect your website with CRM, scheduling, client records, dashboards and the systems your operation already relies on.',
    tags: ['CRM', 'Bookings', 'Client systems', 'APIs'],
  },
  {
    title: 'Managed Infrastructure',
    description:
      'Hosting, deployment, updates, security, monitoring and ongoing technical management without having to coordinate multiple providers.',
    tags: ['Hosting', 'SSL', 'Monitoring', 'Maintenance'],
  },
];

export const OUTCOMES = [
  {
    title: 'Capture more opportunities',
    body: 'Every website enquiry can move directly into a structured follow-up process instead of disappearing into an inbox.',
  },
  {
    title: 'Reduce manual admin',
    body: 'Remove repetitive copying, notifications and hand-offs by connecting the website directly to the systems behind it.',
  },
  {
    title: 'Know what is happening',
    body: 'See leads, customer activity and operational information in a clearer connected view.',
  },
  {
    title: 'Create a better customer journey',
    body: 'Give customers a faster and more professional path from first visit through enquiry, booking and service.',
  },
];

export const FLOW = [
  {
    number: '01',
    title: 'Someone finds you',
    body: 'Your website gives them a clear, fast and professional first experience.',
  },
  {
    number: '02',
    title: 'They make contact',
    body: 'Enquiries and forms capture the information your business actually needs.',
  },
  {
    number: '03',
    title: 'The lead is organised',
    body: 'The enquiry can flow into your CRM or operational system without manual re-entry.',
  },
  {
    number: '04',
    title: 'Follow-up begins',
    body: 'Notifications, tasks and communication workflows can happen automatically.',
  },
  {
    number: '05',
    title: 'The customer moves forward',
    body: 'Bookings, client records or the next stage of your service stay connected.',
  },
  {
    number: '06',
    title: 'You see the operation',
    body: 'BrainBase can bring activity, priorities and operational context into one place.',
  },
];

export const START_WITH = ['Website', 'Enquiry capture'];
export const EXPAND_INTO = ['Leads / CRM', 'Bookings', 'Workflows', 'Dashboards', 'HLNA'];

export const SYSTEM_CONNECTIONS = ['CRM', 'Bookings', 'Automation', 'Dashboards'];

export const DEPLOYMENT_CHAIN = [
  { name: 'Public Website', detail: 'Customer-facing experience' },
  { name: 'Lead Management', detail: 'Enquiries and follow-up' },
  { name: 'Client Operations', detail: 'Clients and activity' },
  { name: 'Session Management', detail: 'Programs and scheduling' },
  { name: 'BrainBase', detail: 'Operational platform' },
];

export const DEPLOYMENTS = [
  {
    label: 'Website Foundation',
    title: 'Start with the website.',
    description:
      'A professionally designed and managed website with lead capture, hosting and the foundations needed to connect more later.',
    includes: [
      'Custom website design & build',
      'Responsive development',
      'Managed hosting & SSL',
      'Contact and enquiry capture',
      'Ongoing maintenance',
    ],
    action: 'Discuss your website',
    featured: false,
  },
  {
    label: 'Connected Web System',
    title: 'Connect the customer journey.',
    description:
      'Extend your website into the business with lead management, booking, integrations and automated workflow.',
    includes: [
      'Everything in Website Foundation',
      'CRM or lead integration',
      'Booking and scheduling connections',
      'Workflow automation',
      'Operational visibility',
    ],
    action: 'Discuss your system',
    featured: true,
  },
  {
    label: 'BrainBase Deployment',
    title: 'Build the system behind it.',
    description:
      'For businesses ready to move beyond the website into a broader connected operational platform.',
    includes: [
      'Everything in Connected Web System',
      'BrainBase platform deployment',
      'Dashboards and reporting',
      'Custom operational workflows',
      'HLNA intelligence capability',
    ],
    action: 'Request deployment review',
    featured: false,
  },
];

export const PROCESS = [
  {
    number: '01',
    title: 'Understand',
    body: 'We look at your website, customer journey and the systems already used behind the scenes.',
  },
  {
    number: '02',
    title: 'Design',
    body: 'We design the website and decide what should connect, automate or remain intentionally simple.',
  },
  {
    number: '03',
    title: 'Build',
    body: 'The website is built and tested.',
  },
  {
    number: '04',
    title: 'Connect',
    body: 'The required operational connections — leads, bookings, workflows or reporting — are configured and verified.',
  },
  {
    number: '05',
    title: 'Launch',
    body: 'Your new system goes live with hosting and monitoring in place.',
  },
  {
    number: '06',
    title: 'Improve',
    body: 'The system can continue to expand as your business, services and operational requirements change.',
  },
];

export const MANAGED = [
  {
    title: 'Hosting',
    body: 'Managed deployment and infrastructure for the website and connected services.',
  },
  {
    title: 'Security & SSL',
    body: 'Secure HTTPS, platform updates and ongoing infrastructure management.',
  },
  {
    title: 'Monitoring',
    body: 'Website availability and core infrastructure can be monitored after launch.',
  },
  {
    title: 'Performance',
    body: 'Ongoing attention to loading speed, responsiveness and user experience.',
  },
  {
    title: 'Updates',
    body: 'Content, workflow and system improvements can continue after deployment.',
  },
  {
    title: 'Support',
    body: 'One point of contact across the website and connected BrainBase environment.',
  },
];
