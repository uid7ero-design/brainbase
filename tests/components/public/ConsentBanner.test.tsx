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
    localStorage.clear();
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

// Real-clients bundle: the consent prompt appeared over private workspaces
// because eligibility was path-only and the signed-in header's logo links
// to "/". A signed-in session now never shows the prompt or starts Clarity,
// on any path, and never touches the stored choice.
describe('Analytics inside a signed-in session', () => {
  beforeEach(() => {
    nav.pathname = '/';
    localStorage.clear();
    delete (window as { clarity?: unknown }).clarity;
  });

  it.each(['/', '/pricing', '/demo', '/admin/founder', '/clients/org-1', '/dashboard'])(
    'shows no prompt and loads no Clarity on %s when authenticated',
    path => {
      nav.pathname = path;
      renderBrainbase(<ClarityLoader authenticated />);
      expect(region()).toBeNull();
      expect(screen.queryByTestId('microsoft-clarity')).toBeNull();
    },
  );

  it('previously granted consent is neither used nor changed while signed in, and a running Clarity is stopped', () => {
    localStorage.setItem('bb-analytics-consent', 'granted');
    const clarity = vi.fn();
    (window as { clarity?: unknown }).clarity = clarity;
    renderBrainbase(<ClarityLoader authenticated />);
    expect(screen.queryByTestId('microsoft-clarity')).toBeNull();
    expect(region()).toBeNull();
    expect(localStorage.getItem('bb-analytics-consent')).toBe('granted');
    expect(clarity).toHaveBeenCalledWith('consent', false);
    expect(clarity).toHaveBeenCalledWith('stop');
    expect(clarity).not.toHaveBeenCalledWith('start');
  });

  it('never writes a consent value on its own', () => {
    renderBrainbase(<ClarityLoader authenticated />);
    expect(localStorage.getItem('bb-analytics-consent')).toBeNull();
  });

  it('signed-out public pages keep the explicit Allow/Decline prompt (unchanged)', () => {
    renderBrainbase(<ClarityLoader authenticated={false} />);
    expect(screen.getByRole('button', { name: 'Allow analytics' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument();
    expect(screen.queryByTestId('microsoft-clarity')).toBeNull();
    expect(localStorage.getItem('bb-analytics-consent')).toBeNull();
  });

  it('signed-out with stored consent still loads Clarity on a public page (unchanged)', () => {
    localStorage.setItem('bb-analytics-consent', 'granted');
    renderBrainbase(<ClarityLoader />);
    expect(screen.getByTestId('microsoft-clarity')).toBeInTheDocument();
    expect(region()).toBeNull();
  });
});
