import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import OrgSwitcher from '@/components/admin/OrgSwitcher';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Phase B — the super-admin organisation context bar. Proves the two
// states are distinguishable in text (not colour alone), the list is
// keyboard-operable, and the active organisation is exposed to assistive
// tech. Switching itself (POST/DELETE + /dashboard) is unchanged and is
// covered by tests/containment/orgSwitcherUI.test.ts.

const ORGS = [
  { id: 'org-hq', name: 'Brainbase', slug: 'brainbase' },
  { id: 'org-a', name: 'Acme Council', slug: 'acme' },
  { id: 'org-b', name: 'Harbour Tennis', slug: 'harbour' },
];

function mockFetch(impersonating: string | null) {
  const active = ORGS.find(o => o.id === impersonating);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const body =
        url === '/api/me'
          ? { role: 'super_admin', org: { name: active?.name ?? 'Brainbase' } }
          : url === '/api/admin/impersonate'
            ? { orgId: active?.id ?? null, orgName: active?.name ?? null }
            : { orgs: ORGS };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OrgSwitcher chrome', () => {
  it.each(['light', 'dark'] as const)('has no axe violations in the normal state (%s)', async theme => {
    mockFetch(null);
    const { container } = renderBrainbase(<OrgSwitcher initialRole="super_admin" />, { theme });
    await screen.findByRole('button', { name: /Organisation: Brainbase/ });
    await expectNoAxeViolations(container);
  });

  it.each(['light', 'dark'] as const)('has no axe violations while impersonating (%s)', async theme => {
    mockFetch('org-a');
    const { container } = renderBrainbase(<OrgSwitcher initialRole="super_admin" />, { theme });
    await screen.findByRole('button', { name: /Viewing as: Acme Council/ });
    await expectNoAxeViolations(container);
  });

  it('renders nothing for roles below super_admin', () => {
    mockFetch(null);
    const { container } = renderBrainbase(<OrgSwitcher initialRole="admin" />);
    expect(container.textContent).toBe('');
  });

  it('distinguishes impersonation in text and state, not colour alone', async () => {
    mockFetch('org-a');
    const { container } = renderBrainbase(<OrgSwitcher initialRole="super_admin" />);
    await screen.findByRole('button', { name: /Viewing as: Acme Council/ });
    expect(screen.getByText('Viewing as')).toBeVisible();
    expect(container.querySelector('[data-impersonating="true"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Return to Brainbase' })).toBeInTheDocument();
  });

  it('opens from the keyboard onto the active organisation, supports arrows, and Escape returns focus', async () => {
    mockFetch('org-a');
    const { user } = renderBrainbase(<OrgSwitcher initialRole="super_admin" />);
    const trigger = await screen.findByRole('button', { name: /Viewing as: Acme Council/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    trigger.focus();
    await user.keyboard('{Enter}');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const list = screen.getByRole('list', { name: 'Switch organisation' });
    const active = within(list).getByRole('button', { name: 'Acme Council' });
    expect(active).toHaveAttribute('aria-current', 'true');
    expect(active).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(within(list).getByRole('button', { name: 'Harbour Tennis' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('closes when keyboard focus moves outside, but not when the window merely loses focus', async () => {
    mockFetch(null);
    const { user } = renderBrainbase(
      <>
        <OrgSwitcher initialRole="super_admin" />
        <button type="button">Next control</button>
      </>,
    );
    const trigger = await screen.findByRole('button', { name: /Organisation: Brainbase/ });
    trigger.focus();
    await user.keyboard('{Enter}');
    const first = within(screen.getByRole('list', { name: 'Switch organisation' })).getAllByRole('button')[0];
    expect(first).toHaveFocus();

    first.blur();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    first.focus();
    await user.keyboard('{End}');
    await user.tab();
    expect(screen.getByRole('button', { name: 'Next control' })).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('lists every organisation from /api/admin/orgs with exactly one marked current', async () => {
    mockFetch('org-b');
    const { user } = renderBrainbase(<OrgSwitcher initialRole="super_admin" />);
    await user.click(await screen.findByRole('button', { name: /Viewing as: Harbour Tennis/ }));
    const list = screen.getByRole('list', { name: 'Switch organisation' });
    const options = within(list).getAllByRole('button');
    expect(options.map(o => o.textContent)).toEqual(['Brainbase', 'Acme Council', 'Harbour Tennis']);
    expect(options.filter(o => o.getAttribute('aria-current') === 'true')).toHaveLength(1);
  });
});
