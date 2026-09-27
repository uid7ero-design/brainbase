import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import ClientWorkspace, {
  type Contact, type Implementation, type Lead, type Opportunity, type Person, type PlatformModule,
} from '@/components/clients/ClientWorkspace';

// Authenticated visual-completion pass (P9) — future-tenant regression
// coverage. The shared /clients/[id] workspace must present every tenant
// through the same visual path: a coaching business, a school running
// events/ticketing, and an organisation that does not exist yet. Datasets
// are identically SHAPED (same counts and states) but carry different
// names, modules and copy, so any tenant-conditional styling — a branch on
// org id, name or module mix — shows up as a structural difference.

const DAY = 86400000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

type Tenant = {
  label: string; orgId: string; people: string[]; modules: PlatformModule[]; program: string; project: string;
};

const TENANTS: Tenant[] = [
  { label: 'coaching-shaped tenant', orgId: 'org_coaching_fixture', people: ['Mia Roberts', 'Noah Patel', 'Ava Chen', 'Leo Martin'],
    modules: [{ key: 'bookings', name: 'Bookings', description: 'Session bookings' }, { key: 'crm', name: 'CRM', description: null }],
    program: 'Junior squad', project: 'Website + booking launch' },
  { label: 'school-shaped tenant (events + ticketing)', orgId: 'org_school_fixture', people: ['Year 7 Office', 'Performing Arts', 'P&C Committee', 'Front Desk'],
    modules: [{ key: 'events', name: 'Events', description: 'Events and ticketing' }, { key: 'crm', name: 'CRM', description: null }],
    program: 'Term 3 production', project: 'Ticketing rollout' },
  { label: 'synthetic future tenant', orgId: 'org_future_fixture', people: ['Harper Lane', 'Quinn Doyle', 'Rowan Ellis', 'Sasha Grey'],
    modules: [{ key: 'facilities', name: 'Facilities', description: 'Sites and assets' }, { key: 'crm', name: 'CRM', description: null }],
    program: 'Site audit', project: 'Portal onboarding' },
];

const STATUSES = ['lead', 'contacted', 'active', 'inactive'];
const LEAD_STATUSES = ['new', 'contacted', 'booked', 'closed'];

function dataset(t: Tenant) {
  const contacts: Contact[] = t.people.map((name, i) => ({
    id: `c${i}`, name, status: STATUSES[i], email: `c${i}@example.test`, phone: '0400 000 000', address: null, age: null,
    program: i % 2 ? null : t.program, session_times: null, next_action: i === 0 ? `Follow up: ${t.program}` : null,
    last_contacted_at: i === 1 ? null : iso(2), created_at: iso(30),
  }));
  const leads: Lead[] = t.people.map((name, i) => ({
    id: `l${i}`, name: `${name} (enquiry)`, status: LEAD_STATUSES[i], email: `l${i}@example.test`, phone: null,
    session_type: i === 0 ? t.program : null, message: i === 0 ? `Enquiry about ${t.program}.` : null, created_at: iso(5),
  }));
  const opportunities: Opportunity[] = [
    { key: 'cold_leads', label: 'Leads going cold', description: 'Enquiries stuck in "new" for more than 3 days',
      items: [{ id: 'l0', name: leads[0].name, detail: `5d old · ${t.program}`, type: 'lead' }] },
    { key: 'no_next_action', label: 'No next action set', description: 'Active contacts missing a next action', items: [] },
  ];
  const implementations: Implementation[] = [
    { id: 'i1', name: t.project, service_type: 'Web', stage: 'build', health: 'at_risk', next_action: 'Confirm schedule',
      target_launch_date: null, actual_launch_date: null },
    { id: 'i2', name: `${t.project} phase 2`, service_type: null, stage: 'live', health: 'on_track', next_action: null,
      target_launch_date: null, actual_launch_date: null },
  ];
  const people: Person[] = [
    { id: 'u1', name: `${t.people[0]} (admin)`, email: 'admin@example.test', role: 'ADMIN', last_login_at: iso(0) },
    { id: 'u2', name: `${t.people[1]} (viewer)`, email: null, role: 'VIEWER', last_login_at: null },
  ];
  return { contacts, leads, opportunities, implementations, people, modules: t.modules };
}

function render(t: Tenant, theme: 'light' | 'dark') {
  const d = dataset(t);
  return renderBrainbase(
    <ClientWorkspace orgId={t.orgId} contacts={d.contacts} leads={d.leads} opportunities={d.opportunities}
      modules={d.modules} implementations={d.implementations} people={d.people} peopleTotal={d.people.length} />,
    { theme },
  );
}

// Structure + presentation signature, ignoring text content and ids:
// element, classes, role, ARIA state and every inline style declaration.
function signature(root: Element): string[] {
  return Array.from(root.querySelectorAll<HTMLElement>('*')).map(el => [
    el.tagName.toLowerCase(),
    [...el.classList].sort().join('.'),
    el.getAttribute('role') ?? '',
    el.getAttribute('aria-selected') ?? '', el.getAttribute('aria-expanded') ?? '', el.getAttribute('aria-pressed') ?? '',
    el.getAttribute('style') ?? '',
  ].join('|'));
}

// Inline colour values must resolve through theme tokens — never a literal
// that would stay fixed while the theme changes.
function literalInlineColours(root: Element): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[style]'))) {
    const style = el.getAttribute('style') ?? '';
    for (const decl of style.split(';')) {
      const [prop, ...rest] = decl.split(':');
      const value = rest.join(':').trim();
      if (!prop || !/color|background|border|fill|stroke|shadow/i.test(prop)) continue;
      if (/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i.test(value.replace(/var\([^)]*\)/g, ''))) out.push(`${el.tagName.toLowerCase()} ${decl.trim()}`);
    }
  }
  return out;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ contact: {} }), { status: 200 })));
});

describe.each(['light', 'dark'] as const)('future-tenant parity — shared ClientWorkspace (%s)', theme => {
  it('renders every tenant through one identical visual structure', () => {
    const sigs = TENANTS.map(t => {
      const { container, unmount } = render(t, theme);
      const s = signature(container);
      unmount();
      return s;
    });
    expect(sigs[0].length).toBeGreaterThan(40);
    expect(sigs[1]).toEqual(sigs[0]);
    expect(sigs[2]).toEqual(sigs[0]);
  });

  describe.each(TENANTS)('$label', t => {
    it('shows its own data with no literal inline colours', () => {
      const { container } = render(t, theme);
      expect(container.textContent).toContain(t.people[0]);
      expect(container.textContent).toContain(t.project);
      expect(literalInlineColours(container)).toEqual([]);
    });

    it('has no axe violations', async () => {
      const { container } = render(t, theme);
      await expectNoAxeViolations(container);
    });
  });
});
