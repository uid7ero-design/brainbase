import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectKeyboardActivation } from '../../a11y/keyboard';

// Presentation-only change to the consent prompt: these tests pin the
// unchanged consent behaviour alongside the new theming.

const nav = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => nav.pathname }));
vi.mock('next/script', () => ({
  default: ({ id }: { id: string }) => <script data-testid={id} />,
}));

import ClarityLoader from '@/components/analytics/ClarityLoader';

function region() {
  return screen.queryByRole('region', { name: 'Analytics preference' });
}

describe('Analytics consent prompt', () => {
  beforeEach(() => {
    nav.pathname = '/';
  });

  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<ClarityLoader />, { theme });
    expect(region()).not.toBeNull();
    await expectNoAxeViolations(container);
  });

  it('follows the site theme on converted routes and stays dark elsewhere', () => {
    const { unmount } = renderBrainbase(<ClarityLoader />);
    expect(region()).not.toHaveClass('bb-scope-dark');
    unmount();

    // Every current consent-eligible page is converted; a prefix-matched
    // sub-route that is not in THEMED_PUBLIC_ROUTES exercises the fallback.
    nav.pathname = '/demo/walkthrough';
    renderBrainbase(<ClarityLoader />);
    expect(region()).toHaveClass('bb-scope-dark');
  });

  it('is not shown on non-eligible routes (unchanged)', () => {
    nav.pathname = '/login';
    renderBrainbase(<ClarityLoader />);
    expect(region()).toBeNull();
  });

  it('Decline stores "declined", hides the prompt and never loads Clarity (unchanged)', async () => {
    const { user } = renderBrainbase(<ClarityLoader />);
    const decline = screen.getByRole('button', { name: 'Decline' });
    await user.click(decline);
    expect(localStorage.getItem('bb-analytics-consent')).toBe('declined');
    expect(region()).toBeNull();
    expect(screen.queryByTestId('microsoft-clarity')).toBeNull();
  });

  it('Allow analytics stores "granted" and loads Clarity (unchanged)', async () => {
    const { user } = renderBrainbase(<ClarityLoader />);
    await user.click(screen.getByRole('button', { name: 'Allow analytics' }));
    expect(localStorage.getItem('bb-analytics-consent')).toBe('granted');
    expect(region()).toBeNull();
    expect(screen.getByTestId('microsoft-clarity')).toBeInTheDocument();
  });

  it('choices are keyboard-operable and link to the privacy policy', async () => {
    const { user } = renderBrainbase(<ClarityLoader />);
    expect(screen.getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    const decline = screen.getByRole('button', { name: 'Decline' });
    const spy = vi.fn();
    decline.addEventListener('click', spy);
    await expectKeyboardActivation(user, decline, spy, 'Enter');
  });
});
