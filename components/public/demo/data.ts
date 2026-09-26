// /demo simulated data — carried over verbatim from the previous
// app/demo/page.tsx. The only change is presentational: hardcoded hex
// colours became semantic tones, rendered through --bb-* tokens so the
// demo reads correctly in light and dark themes. Every tone is paired with
// visible text (status word, movement value, label), never colour alone.

export type Tone = 'success' | 'warning' | 'error' | 'info' | 'active'

export type TabId =
  | 'overview'
  | 'financial'
  | 'operations'
  | 'customers'
  | 'workforce'
  | 'assets'
  | 'reporting'

export type DemoQuestion = {
  question: string
  answer: string
}

export type Metric = {
  label: string
  value: string
  note: string
  tone: Tone
}

export const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'financial', label: 'Financial' },
  { id: 'operations', label: 'Operations' },
  { id: 'customers', label: 'Customers' },
  { id: 'workforce', label: 'Workforce' },
  { id: 'assets', label: 'Assets' },
  { id: 'reporting', label: 'Reporting' },
]

export const SYSTEM_STATUS: { label: string; status: string; tone: Tone }[] = [
  { label: 'Operations', status: 'Attention', tone: 'warning' },
  { label: 'Customers', status: 'Stable', tone: 'success' },
  { label: 'Assets', status: 'Operational', tone: 'success' },
  { label: 'Workforce', status: 'Watch', tone: 'warning' },
  { label: 'Financial', status: 'Stable', tone: 'success' },
  { label: 'Service Risk', status: 'Elevated', tone: 'error' },
]

export const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    question: 'What needs attention today?',
    answer:
      'Three areas need attention. The service backlog is the highest priority, with 18 requests outside target. Operating costs are 4.8% above monthly plan, primarily from fuel, contractor hours and reactive maintenance. Tomorrow also has three uncovered shifts. I would address the backlog first, then confirm workforce coverage before reviewing the cost variance.',
  },
  {
    question: 'Where are costs increasing?',
    answer:
      'Operating costs are currently 4.8% above monthly plan. The main drivers are fuel, external contractor hours and reactive asset maintenance. Fleet Unit 08 is contributing disproportionately to maintenance expenditure and should be reviewed before the next service cycle.',
  },
  {
    question: 'Summarise operational risk',
    answer:
      'Overall operational risk is moderate. Customer response performance is improving, but one service backlog is outside target and workforce capacity is constrained tomorrow. Asset availability remains healthy at 92%, so the immediate risk is resourcing rather than equipment capacity.',
  },
  {
    question: 'What is performing well?',
    answer:
      'Customer response performance is the strongest current improvement. 91% of requests are now being handled within target, up 6 percentage points over the last reporting period. Asset availability is stable at 92%, and customer satisfaction remains above target.',
  },
]

export const ALERTS: {
  label: string
  title: string
  value: string
  detail: string
  description: string
  tone: Tone
}[] = [
  {
    label: 'High Priority',
    title: 'Service backlog exceeding target',
    value: '18',
    detail: 'open requests',
    description: 'Customer requests in the southern service area are exceeding the target response window.',
    tone: 'error',
  },
  {
    label: 'Monitor',
    title: 'Operating cost trending above forecast',
    value: '+4.8%',
    detail: 'vs monthly plan',
    description: 'Fuel, contractor hours and reactive maintenance are driving the current variance.',
    tone: 'warning',
  },
  {
    label: 'Workforce',
    title: 'Tomorrow has uncovered capacity',
    value: '3',
    detail: 'shifts uncovered',
    description: 'Available internal capacity is below planned requirements for tomorrow morning.',
    tone: 'warning',
  },
]

export const FINANCIAL_METRICS: Metric[] = [
  { label: 'Operating Budget', value: '$4.82m', note: 'Annual allocation', tone: 'active' },
  { label: 'Actual YTD', value: '$3.11m', note: '64.5% utilised', tone: 'info' },
  { label: 'Forecast', value: '$4.91m', note: '+1.9% variance', tone: 'warning' },
  { label: 'Identified Savings', value: '$184k', note: 'Current opportunities', tone: 'success' },
]

export const COST_DRIVERS: [string, string, string, Tone][] = [
  ['Fuel & Energy', '$672k', '+7.2%', 'error'],
  ['Labour', '$1.42m', '+1.4%', 'success'],
  ['Contractors', '$583k', '+9.8%', 'error'],
  ['Maintenance', '$438k', '+5.6%', 'warning'],
  ['Processing', '$721k', '-2.3%', 'success'],
]

export const CUSTOMER_ROWS = [
  ['REQ-1048', 'Service request', 'Escalated', '6 days'],
  ['REQ-1042', 'Missed service', 'Active', '3 days'],
  ['REQ-1037', 'General enquiry', 'In progress', '2 days'],
  ['REQ-1029', 'Asset issue', 'Resolved', '1 day'],
]

export const ASSET_ROWS = [
  ['Fleet Unit 08', 'Heavy Vehicle', 'Unavailable', 'Maintenance review'],
  ['Fleet Unit 12', 'Heavy Vehicle', 'Operational', 'Available'],
  ['Mobile Crew 03', 'Field Asset', 'Operational', 'Available'],
  ['Site Plant 04', 'Plant', 'Restricted', 'Inspection due'],
]

export const REPORTS = [
  {
    icon: '↗',
    title: 'Executive Summary',
    description: 'Operational performance, exceptions and key decisions in one briefing.',
    status: 'Ready',
  },
  {
    icon: '◫',
    title: 'Monthly Performance',
    description: 'Service, customer, asset and financial performance prepared automatically.',
    status: 'Scheduled',
  },
  {
    icon: '⚡',
    title: 'Exception Report',
    description: 'Only surface areas that have moved outside an agreed threshold.',
    status: 'Automated',
  },
  {
    icon: '◎',
    title: 'HLNA Analysis',
    description: 'Ask questions across operational information without building another report.',
    status: 'Live',
  },
]

export const SCENARIO_STEPS = [
  'New service request logged — REQ-1053',
  'Added to the open requests queue — Open Requests 48 → 49',
  'Flagged for Operations — workload updated',
  "HLNA: This adds to today's backlog — worth prioritising before end of day.",
]

/**
 * The previous page's canned-answer matcher, extracted unchanged: exact
 * question match first, then keyword fallbacks, then the default briefing.
 */
export function matchDemoAnswer(q: string): DemoQuestion {
  const exact = DEMO_QUESTIONS.find(item => item.question.toLowerCase() === q.toLowerCase())
  const lower = q.toLowerCase()
  return (
    exact ??
    (lower.includes('cost')
      ? DEMO_QUESTIONS[1]
      : lower.includes('risk')
        ? DEMO_QUESTIONS[2]
        : lower.includes('perform')
          ? DEMO_QUESTIONS[3]
          : DEMO_QUESTIONS[0])
  )
}
