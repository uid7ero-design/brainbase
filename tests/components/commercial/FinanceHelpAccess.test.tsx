import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceHelpPage from '@/app/commercial/help/page';
import CommercialSidebar from '@/app/commercial/_components/CommercialSidebar';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), capability: vi.fn(), redirect: vi.fn() }));
vi.mock('@/lib/commercial/authorize', () => ({ authorizeCommercialRequest: mocks.auth, COMMERCIAL_MIN_ROLE: { view: 'viewer' } }));
vi.mock('@/lib/capabilities/requireCapability', () => ({ checkCapability: mocks.capability }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, usePathname: () => '/commercial/help' }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.redirect.mockImplementation(() => { throw new Error('login redirect'); });
});
afterEach(cleanup);

describe('Finance help access and destinations', () => {
  it('redirects a signed-out reader without loading capability data', async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    await expect(FinanceHelpPage()).rejects.toThrow('login redirect');
    expect(mocks.redirect).toHaveBeenCalledWith('/login');
    expect(mocks.capability).not.toHaveBeenCalled();
  });

  it.each([403, 503])('fails closed for an unavailable or denied entitlement (%s)', async status => {
    mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    render(await FinanceHelpPage());
    expect(screen.getByRole('alert')).toHaveTextContent(status === 503 ? 'Unable to verify' : 'access is required');
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    expect(mocks.capability).not.toHaveBeenCalled();
  });

  it('lets a purchasing viewer read the guide without budgeting or administration links', async () => {
    mocks.auth.mockResolvedValue({ ok: true, session: { organisationId: 'reader-org', role: 'viewer' } });
    mocks.capability.mockImplementation(async (_org: string, key: string) => ({ allowed: key === 'purchasing' }));
    render(await FinanceHelpPage());
    expect(mocks.auth).toHaveBeenCalledWith(['purchasing', 'budgeting'], 'viewer');
    expect(mocks.capability.mock.calls.every(([org]) => org === 'reader-org')).toBe(true);
    expect(screen.getByRole('link', { name: 'Open Supplier Bills' })).toHaveAttribute('href', '/commercial/purchasing/supplier-bills');
    expect(screen.queryByRole('link', { name: 'Open Finance Setup' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Budget vs Actual' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Finance Controls' })).not.toBeInTheDocument();
  });

  it.each(['viewer', 'admin'])('shows only permitted budgeting destinations for a %s', async role => {
    mocks.auth.mockResolvedValue({ ok: true, session: { organisationId: 'budget-org', role } });
    mocks.capability.mockImplementation(async (_org: string, key: string) => ({ allowed: key === 'budgeting' }));
    render(await FinanceHelpPage());
    expect(screen.getByRole('link', { name: 'Open Budget vs Actual' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Supplier Bills' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Finance Setup' }) !== null).toBe(role === 'admin');
    expect(screen.queryByRole('link', { name: 'Open Finance Controls', hidden: true }) !== null).toBe(role === 'admin');
  });

  it('keeps the help navigation hidden without purchasing or budgeting and marks its active destination', () => {
    const view = render(<CommercialSidebar quotesEnabled />);
    expect(screen.queryByRole('link', { name: 'Finance Help & How to' })).not.toBeInTheDocument();
    view.rerender(<CommercialSidebar purchasingEnabled />);
    expect(screen.getByRole('link', { name: 'Finance Help & How to' })).toHaveAttribute('aria-current', 'page');
    view.rerender(<CommercialSidebar budgetingEnabled />);
    expect(screen.getByRole('link', { name: 'Finance Help & How to' })).toHaveAttribute('href', '/commercial/help');
  });
});
