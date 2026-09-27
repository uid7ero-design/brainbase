import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import ClientWorkspace, {
  type Contact, type Implementation, type Lead, type Opportunity, type Person, type PlatformModule,
} from '@/components/clients/ClientWorkspace';

// Authenticated visual-completion pass (P4) — the shared /clients/[id]
// workspace rendered for real in light AND dark. It used to paint every
// foreground in fixed dark-theme literals (near-white names, white-alpha
// meta/labels/empty states), which were invisible on the light surface.
// Two datasets: a coaching-business-shaped tenant (statuses across every
// contact/lead state, opportunities, implementations, people, modules) and
// a synthetic generic organisation — the component carries no tenant logic.

const DAY = 86400000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString();

type Dataset = {
  name: string;
  contacts: Contact[]; leads: Lead[]; opportunities: Opportunity[];
  modules: PlatformModule[]; implementations: Implementation[]; people: Person[]; peopleTotal: number;
};

const contact = (id: string, name: string, status: string, extra: Partial<Contact> = {}): Contact => ({
  id, name, status, email: `${id}@example.test`, phone: '0400 000 00' + id.length, address: null, age: null,
  program: null, session_times: null, next_action: null, last_contacted_at: iso(2), created_at: iso(30), ...extra,
});
const lead = (id: string, name: string, status: string, extra: Partial<Lead> = {}): Lead => ({
  id, name, status, email: `${id}@example.test`, phone: null, session_type: null, message: null, created_at: iso(5), ...extra,
});

const COACHING: Dataset = {
  name: 'coaching-shaped tenant',
  contacts: [
    contact('c1', 'Mia Roberts', 'lead', { next_action: 'Call to book trial', program: 'Junior squad' }),
    contact('c2', 'Noah Patel', 'contacted', { last_contacted_at: null }),
    contact('c3', 'Ava Chen', 'active', { program: 'Adult beginner', session_times: 'Tues 6pm' }),
    contact('c4', 'Leo Martin', 'inactive'),
  ],
  leads: [
    lead('l1', 'Isla Brown', 'new', { session_type: 'Private lesson', message: 'Looking for weekend coaching.', phone: '0411 222 333' }),
    lead('l2', 'Jack Wilson', 'booked', { session_type: 'Group clinic' }),
    lead('l3', 'Ruby Scott', 'contacted'),
    lead('l4', 'Oscar King', 'closed'),
  ],
  opportunities: [
    { key: 'cold_leads', label: 'Leads going cold', description: 'Enquiries stuck in "new" for more than 3 days with no follow-up',
      items: [{ id: 'l1', name: 'Isla Brown', detail: '5d old · Private lesson', type: 'lead' }] },
    { key: 'no_followup', label: 'Contacts overdue for contact', description: 'Active or lead contacts not reached in 14+ days',
      items: [{ id: 'c2', name: 'Noah Patel', detail: 'Never contacted', type: 'contact' }] },
    { key: 'no_next_action', label: 'No next action set', description: 'Active contacts missing a next action', items: [] },
    { key: 'booked_upgrade', label: 'Booked leads to activate', description: 'Leads marked "booked"',
      items: [{ id: 'l2', name: 'Jack Wilson', detail: 'Group clinic', type: 'lead' }] },
  ],
  modules: [{ key: 'bookings', name: 'Bookings', description: 'Session bookings' }, { key: 'crm', name: 'CRM', description: null }],
  implementations: [
    { id: 'i1', name: 'Website + booking launch', service_type: 'Web', stage: 'build', health: 'at_risk',
      next_action: 'Confirm court schedule', target_launch_date: null, actual_launch_date: null },
    { id: 'i2', name: 'Lead capture', service_type: null, stage: 'live', health: 'on_track',
      next_action: null, target_launch_date: null, actual_launch_date: null },
  ],
  people: [
    { id: 'u1', name: 'Sam Owner', email: 'sam@example.test', role: 'ADMIN', last_login_at: iso(0) },
    { id: 'u2', name: 'Pat Coach', email: null, role: 'VIEWER', last_login_at: null },
  ],
  peopleTotal: 11,
};

const GENERIC: Dataset = {
  name: 'synthetic generic organisation',
  contacts: [contact('g1', 'Harper Lane', 'active', { next_action: 'Send renewal' })],
  leads: [lead('g2', 'Quinn Doyle', 'new')],
  opportunities: [
    { key: 'booked_upgrade', label: 'Booked leads to activate', description: 'Leads marked "booked"', items: [] },
  ],
  modules: [],
  implementations: [],
  people: [],
  peopleTotal: 0,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ contact: {} }), { status: 200 })));
});

function render(ds: Dataset, theme: 'light' | 'dark') {
  return renderBrainbase(
    <ClientWorkspace orgId="org_synthetic" contacts={ds.contacts} leads={ds.leads} opportunities={ds.opportunities}
      modules={ds.modules} implementations={ds.implementations} people={ds.people} peopleTotal={ds.peopleTotal} />,
    { theme },
  );
}

// jsdom has no real CSS variables / CSS modules, so contrast cannot be
// computed. Instead: no rendered element may carry an inline foreground or
// background that is a white-alpha or near-white literal — the exact class
// of value that made this workspace invisible in light mode.
function expectNoNearWhiteInlineColours(root: Element) {
  const offenders: string[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    for (const prop of ['color', 'backgroundColor', 'borderColor'] as const) {
      const v = el.style[prop];
      if (!v) continue;
      const m = v.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
      let rgb: number[] | null = m ? [m[1], m[2], m[3]].map(Number) : null;
      if (hex) {
        const h = hex[1].length === 3 ? hex[1].split('').map(c => c + c).join('') : hex[1];
        rgb = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
      }
      if (rgb && rgb.every(c => c >= 230)) offenders.push(`<${el.tagName.toLowerCase()}> ${prop}: ${v}`);
    }
  }
  expect(offenders).toEqual([]);
}

describe.each(['light', 'dark'] as const)('ClientWorkspace (%s)', theme => {
  describe.each([COACHING, GENERIC])('$name', ds => {
    it('renders every overview item, contact name/detail/status and no near-white inline colours', async () => {
      const { container } = render(ds, theme);
      for (const m of ds.modules) expect(screen.getByText(m.name)).toBeInTheDocument();
      if (ds.modules.length === 0) expect(screen.getByText('No platform modules enabled')).toBeInTheDocument();
      for (const i of ds.implementations) expect(screen.getByText(i.name)).toBeInTheDocument();
      if (ds.implementations.length === 0) expect(screen.getByText('No implementations recorded')).toBeInTheDocument();
      for (const p of ds.people) expect(screen.getByText(p.name)).toBeInTheDocument();
      if (ds.people.length === 0) expect(screen.getByText('No users on this account')).toBeInTheDocument();
      if (ds.peopleTotal > ds.people.length) {
        expect(screen.getByText(`+${ds.peopleTotal - ds.people.length} more`)).toBeInTheDocument();
      }
      for (const c of ds.contacts) {
        const row = screen.getByRole('button', { name: new RegExp(c.name) });
        expect(within(row).getByText(c.status)).toBeInTheDocument();
        if (c.email) expect(within(row).getByText(new RegExp(c.email))).toBeInTheDocument();
        if (c.next_action) expect(within(row).getByText(`→ ${c.next_action}`)).toBeInTheDocument();
      }
      expect(screen.getByRole('tab', { name: `Contacts (${ds.contacts.length})` })).toHaveAttribute('aria-selected', 'true');
      expectNoNearWhiteInlineColours(container);
      await expectNoAxeViolations(container);
    });

    it('tabs are keyboard operable and each panel shows its full data', async () => {
      const { container, user } = render(ds, theme);
      const contactsTab = screen.getByRole('tab', { name: /^Contacts/ });
      contactsTab.focus();
      await user.keyboard('{ArrowRight}');
      const leadsTab = screen.getByRole('tab', { name: /^Leads/ });
      expect(leadsTab).toHaveFocus();
      expect(leadsTab).toHaveAttribute('aria-selected', 'true');
      expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', leadsTab.id);
      for (const l of ds.leads) {
        const row = screen.getByRole('button', { name: new RegExp(l.name) });
        expect(row).toHaveAttribute('aria-expanded', 'false');
        const label = { new: 'New', contacted: 'Contacted', booked: 'Booked', closed: 'Closed' }[l.status]!;
        expect(within(row).getByText(label)).toBeInTheDocument();
      }
      // Expand the first lead with the keyboard.
      const first = screen.getByRole('button', { name: new RegExp(ds.leads[0].name) });
      first.focus();
      await user.keyboard('{Enter}');
      expect(first).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('group', { name: 'Move to' })).toBeInTheDocument();
      if (ds.leads[0].message) expect(screen.getByText(ds.leads[0].message)).toBeInTheDocument();
      expectNoNearWhiteInlineColours(container);
      await expectNoAxeViolations(container);

      leadsTab.focus();
      await user.keyboard('{End}');
      const oppTab = screen.getByRole('tab', { name: /^Opportunities/ });
      expect(oppTab).toHaveFocus();
      const nonempty = ds.opportunities.filter(o => o.items.length > 0);
      if (nonempty.length === 0) {
        expect(screen.getByText('No opportunities flagged — everything looks healthy.')).toBeInTheDocument();
      }
      for (const o of nonempty) {
        const section = screen.getByRole('region', { name: o.label });
        expect(within(section).getByText(String(o.items.length))).toBeInTheDocument();
        for (const item of o.items) {
          expect(within(section).getByText(item.name)).toBeInTheDocument();
          expect(within(section).getByText(item.detail)).toBeInTheDocument();
        }
      }
      expectNoNearWhiteInlineColours(container);
      await expectNoAxeViolations(container);
    });

    it('the contact editor opens as a labelled modal dialog, keeps its fields, and closes on Escape', async () => {
      const { user } = render(ds, theme);
      const c = ds.contacts[0];
      const row = screen.getByRole('button', { name: new RegExp(c.name) });
      await user.click(row);
      const dialog = screen.getByRole('dialog', { name: c.name });
      expect(dialog).toHaveAttribute('aria-modal', 'true');
      for (const label of ['Name', 'Email', 'Phone', 'Status', 'Age', 'Program', 'Session times', 'Next action', 'Address']) {
        expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
      }
      expect(within(dialog).getByLabelText('Name')).toHaveValue(c.name);
      expect(within(dialog).getByRole('button', { name: 'Save changes' })).toBeEnabled();
      expectNoNearWhiteInlineColours(document.body);
      await expectNoAxeViolations(document.body);
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(row).toHaveFocus();
    });
  });
});

describe('ClientWorkspace — contact save keeps the PATCH contract', () => {
  it('saves through /api/admin/client-data/contacts/:id with orgId and the edited form', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ contact: { ...COACHING.contacts[0], name: 'Mia R.' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { user } = render(COACHING, 'light');
    await user.click(screen.getByRole('button', { name: /Mia Roberts/ }));
    const name = screen.getByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'Mia R.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/admin/client-data/contacts/c1');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toMatchObject({ orgId: 'org_synthetic', id: 'c1', name: 'Mia R.' });
  });
});
