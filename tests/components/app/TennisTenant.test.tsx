import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Authenticated visual-completion pass (P5) — the tennis tenant's own
// signed-in surfaces rendered for real in light AND dark. These pages used
// dark-only Tailwind (text-white / text-zinc-* / bg-white/N) and fixed dark
// inline literals that vanished on the light surface. Tenant-specific
// components, so tennis-shaped fixtures are appropriate here.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard/contacts',
  useSearchParams: () => new URLSearchParams(''),
  useParams: () => ({}),
}));

const { default: ContactsClient } = await import('@/app/dashboard/contacts/ContactsClient');
const { default: ContactDetailClient } = await import('@/app/dashboard/contacts/[id]/ContactDetailClient');
const { default: JournalClient } = await import('@/app/dashboard/contacts/[id]/JournalClient');
const { default: LeadStatusPicker } = await import('@/app/dashboard/leads/[id]/LeadStatusPicker');
const { default: LeadMessaging } = await import('@/app/dashboard/leads/[id]/LeadMessaging');
const { default: ConvertToSquadButton } = await import('@/app/dashboard/leads/[id]/ConvertToSquadButton');
const { default: DeleteLeadButton } = await import('@/app/dashboard/leads/[id]/DeleteLeadButton');

const DAY = 86400000;
const iso = (d: number) => new Date(Date.now() - d * DAY).toISOString();

const CONTACTS = [
  { id: 'c1', name: 'Mia Roberts', email: 'mia@example.test', phone: '0400 111 222', status: 'active', last_contacted_at: iso(1), created_at: iso(40) },
  { id: 'c2', name: 'Noah Patel', email: 'noah@example.test', phone: null, status: 'lead', last_contacted_at: null, created_at: iso(3) },
  { id: 'c3', name: 'Ava Chen', email: 'ava@example.test', phone: '0400 333 444', status: 'contacted', last_contacted_at: iso(12), created_at: iso(20) },
  { id: 'c4', name: 'Leo Martin', email: 'leo@example.test', phone: null, status: 'inactive', last_contacted_at: iso(90), created_at: iso(200) },
];

function json(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/dashboard/sessions')) return json({ sessions: [
      { id: 's1', name: 'Hot Shots', session_type: 'Junior', day_of_week: 2, start_time: '16:00' },
    ] });
    if (url.includes('/messages')) return json({ messages: [
      { id: 'm1', direction: 'outbound', subject: 'Trial lesson', body: 'See you Saturday.', from_address: 'a@example.test',
        to_address: 'b@example.test', resend_message_id: null, created_by: null, created_at: iso(1), sender_name: 'Coach' },
    ] });
    return json({});
  }));
});

function expectNoNearWhiteInlineColours(root: Element) {
  const offenders: string[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    for (const prop of ['color', 'backgroundColor'] as const) {
      const m = el.style[prop].match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (m && [m[1], m[2], m[3]].map(Number).every(c => c >= 230)) offenders.push(`${el.tagName} ${prop} ${el.style[prop]}`);
    }
  }
  expect(offenders).toEqual([]);
}

describe.each(['light', 'dark'] as const)('tennis tenant surfaces (%s)', theme => {
  it('Squad contacts: every tile shows name, contact details and a labelled status; filters are toggle buttons', async () => {
    const { container, user } = renderBrainbase(<ContactsClient contacts={CONTACTS} />, { theme });
    for (const c of CONTACTS) {
      const tile = screen.getByRole('article', { name: c.name });
      expect(within(tile).getByRole('link', { name: c.name })).toBeInTheDocument();
      expect(within(tile).getByText(c.email)).toBeInTheDocument();
      expect(within(tile).getByRole('combobox', { name: `Status for ${c.name}` })).toHaveValue(c.status);
    }
    expect(screen.getByRole('button', { name: /All \(4\)/ })).toHaveAttribute('aria-pressed', 'true');
    expectNoNearWhiteInlineColours(container);
    await expectNoAxeViolations(container);

    await user.click(screen.getByRole('button', { name: /^Active/ }));
    expect(screen.getByRole('button', { name: /^Active/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  it('the New Contact drawer is a labelled modal dialog with labelled fields and closes on Escape', async () => {
    const { user } = renderBrainbase(<ContactsClient contacts={CONTACTS} />, { theme });
    const opener = screen.getByRole('button', { name: '+ New Contact' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'New Contact' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    for (const label of ['Name *', 'Email', 'Phone', 'Status', 'Address', 'Age', 'Program', 'Session', 'Session Times', 'Next Action']) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument();
    }
    await user.type(within(dialog).getByLabelText('Age'), '12');
    expect(within(dialog).getByRole('group', { name: 'Guardian Details — required (under 18)' })).toBeInTheDocument();
    await expectNoAxeViolations(document.body);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('contact detail + journal: labelled status, details list and session notes', async () => {
    const { container } = renderBrainbase(
      <div>
        <ContactDetailClient contact={{ ...CONTACTS[0], address: '12 Main St', age: 14, program: 'Hot Shots', session_times: 'Tue 4pm', next_action: 'Confirm Thursday' }} />
        <JournalClient contactId="c1" initial={[{ id: 'j1', note: 'Great backhand progress.', created_at: iso(2) }]} />
      </div>, { theme });
    expect(screen.getByLabelText('Status')).toHaveValue('active');
    for (const v of ['Hot Shots', 'Tue 4pm', '12 Main St', 'Confirm Thursday', 'Great backhand progress.']) {
      expect(screen.getByText(v)).toBeInTheDocument();
    }
    expect(screen.getByRole('textbox', { name: 'Session note' })).toBeInTheDocument();
    expectNoNearWhiteInlineColours(container);
    await expectNoAxeViolations(container);
  });

  it('lead detail: status toggle group, labelled note/email fields, message history, squad + delete actions', async () => {
    const { container, user } = renderBrainbase(
      <div>
        <LeadStatusPicker leadId="l1" currentStatus="new" currentNotes="Called once" />
        <LeadMessaging leadId="l1" leadName="Isla Brown" leadEmail="isla@example.test" />
        <ConvertToSquadButton leadId="l1" initialInSquad={false} />
        <DeleteLeadButton leadId="l1" />
      </div>, { theme });
    const statusGroup = screen.getByRole('group', { name: 'Status' });
    expect(within(statusGroup).getByRole('button', { name: 'New' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(statusGroup).getByRole('button', { name: 'Booked' }));
    expect(within(statusGroup).getByRole('button', { name: 'Booked' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Note')).toHaveValue('Called once');
    expect(screen.getByRole('switch', { name: 'Notify client by email' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByLabelText('Subject')).toHaveValue('LD Tennis — your enquiry');
    expect(await screen.findByText('Trial lesson')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add to Squad' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Delete lead' }));
    expect(screen.getByRole('button', { name: 'Yes, delete' })).toBeInTheDocument();
    expectNoNearWhiteInlineColours(container);
    await expectNoAxeViolations(container);
  });
});
