import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Phase D4 — representative converted CRM / People / Commercial / Data Hub
// surfaces rendered for real (jsdom) with fixture data behind a stubbed
// fetch: the shared table/header/toolbar contract, labelled controls,
// semantic status and axe in both themes.

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
}));

const { default: QuotesPage } = await import('@/app/commercial/quotes/page');
const { default: ContactsPage } = await import('@/app/crm/contacts/page');
const { default: TeamsPage } = await import('@/app/people/teams/page');
const { default: SourcesAdminClient } = await import('@/app/data-hub/sources/SourcesAdminClient');

function json(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }));
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith('/api/commercial/quotes')) return json({ quotes: [
      { id: 'q1', quote_number: 'Q-0001', status: 'SENT', customer_id: 'c1', customer_name_snapshot: 'Harbour Council', issue_date: '2026-09-01', expiry_date: '2026-09-30', total_cents: 1234500, currency: 'AUD', created_at: '', updated_at: '' },
      { id: 'q2', quote_number: null, status: 'DRAFT', customer_id: 'c1', customer_name_snapshot: null, issue_date: null, expiry_date: null, total_cents: 0, currency: 'AUD', created_at: '', updated_at: '' },
    ] });
    if (url.startsWith('/api/commercial/customers')) return json({ customers: [{ id: 'c1', name: 'Harbour Council' }] });
    if (url.startsWith('/api/crm/contacts')) return json({ contacts: [
      { id: 'p1', first_name: 'Avery', last_name: 'Nguyen', email: 'avery@example.test', phone: null, job_title: 'Operations lead', company_name: 'Harbour Council', activity_count: 3, classification: 'CLIENT' },
    ] });
    if (url.startsWith('/api/hr/teams')) return json({ teams: [
      { id: 't1', name: 'Field crew', description: 'Kerbside operations', manager_person_id: null, archived_at: null },
    ], canManage: true });
    if (url.startsWith('/api/hr/people')) return json({ people: [], canManage: true });
    if (url.startsWith('/api/data-hub/source-systems')) return json({ sourceSystems: [] });
    return json({});
  }));
});

describe('Commercial quotes list', () => {
  it('header, labelled filter, table contract with a right-aligned money column and a semantic status', async () => {
    const { container } = renderBrainbase(<QuotesPage />);
    expect(await screen.findByText('Q-0001')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Quotes' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Quotes' })).toBeInTheDocument();
    const total = screen.getByRole('columnheader', { name: 'Total' });
    expect(total.className).toMatch(/num/);
    expect(container.querySelector('[data-state]')).toBeInTheDocument();
  });

  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<main><QuotesPage /></main>, { theme });
    await screen.findByText('Q-0001');
    await expectNoAxeViolations(container);
  });
});

describe('CRM contacts list', () => {
  it('labelled classification filter and search; row link names the record', async () => {
    renderBrainbase(<ContactsPage />);
    const row = (await screen.findByText(/Avery/)).closest('tr')!;
    expect(row).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    for (const el of screen.getAllByRole('combobox')) expect(el).toHaveAccessibleName();
    expect(screen.getByRole('searchbox')).toHaveAccessibleName();
  });

  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<main><ContactsPage /></main>, { theme });
    await screen.findByText(/Avery/);
    await expectNoAxeViolations(container);
  });
});

describe('People teams', () => {
  it('status is written (Badge), row actions name the team, create is a primary action', async () => {
    renderBrainbase(<TeamsPage />);
    const cell = await screen.findByText('Field crew');
    const row = cell.closest('tr')!;
    expect(within(row).getByText('Active').closest('[data-state]')).toHaveAttribute('data-state', 'success');
    for (const b of within(row).getAllByRole('button')) expect(b).toHaveAccessibleName();
    expect(screen.getByRole('button', { name: '+ Create Team' })).toBeInTheDocument();
  });

  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<main><TeamsPage /></main>, { theme });
    await screen.findByText('Field crew');
    await expectNoAxeViolations(container);
  });
});

describe('Data Hub source systems (admin)', () => {
  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<main><h1>Data sources</h1><SourcesAdminClient isAdmin /></main>, { theme });
    await screen.findByText(/No source systems configured/);
    await expectNoAxeViolations(container);
  });
});
