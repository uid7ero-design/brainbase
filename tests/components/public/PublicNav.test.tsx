import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import { PublicNav } from '@/components/public/PublicNav';
import { PUBLIC_NAV_LINKS } from '@/components/public/routes';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectAccessibleName } from '../../a11y/accessibility';
import { expectNamedFocusOrder } from '../../a11y/keyboard';

function renderNav(pathname: string) {
  return renderBrainbase(
    <ThemeProvider>
      <PublicNav pathname={pathname} />
    </ThemeProvider>,
  );
}

describe('PublicNav', () => {
  it('has no axe violations', async () => {
    const { container } = renderNav('/');
    await expectNoAxeViolations(container);
  });

  it('keeps the same destinations as the previous public nav', () => {
    renderNav('/');
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    const hrefs = within(primary)
      .getAllByRole('link')
      .map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['/#product', '/client-operations', '/web-systems', '/pricing', '/demo']);
    expect(PUBLIC_NAV_LINKS).toHaveLength(5);
    expect(screen.getAllByRole('link', { name: 'Login' })[0]).toHaveAttribute('href', '/login');
    expect(screen.getByRole('link', { name: 'Get Started' })).toHaveAttribute('href', '/request-demo');
    expect(screen.getByRole('link', { name: 'BrainBase home' })).toHaveAttribute('href', '/');
  });

  it('marks the current page', () => {
    renderNav('/pricing');
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(primary).getByRole('link', { name: 'Pricing' })).toHaveAttribute('aria-current', 'page');
    expect(within(primary).getByRole('link', { name: 'Demo' })).not.toHaveAttribute('aria-current');
  });

  it('offers the theme toggle only on converted routes and pins the rest to dark', () => {
    const { container, unmount } = renderNav('/');
    expect(screen.getByRole('button', { name: /Switch to (light|dark) theme/ })).toBeInTheDocument();
    expect(container.querySelector('header')).not.toHaveClass('bb-scope-dark');
    unmount();

    // /login still uses the previous dark design and shows the public nav.
    const other = renderNav('/login');
    expect(screen.queryByRole('button', { name: /Switch to (light|dark) theme/ })).toBeNull();
    expect(other.container.querySelector('header')).toHaveClass('bb-scope-dark');
  });

  it('theme toggle switches and persists the theme', async () => {
    const { user } = renderNav('/');
    const toggle = screen.getByRole('button', { name: 'Switch to light theme' });
    await user.click(toggle);
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(localStorage.getItem('bb-theme')).toBe('light');
    expectAccessibleName(screen.getByRole('button', { name: 'Switch to dark theme' }), 'Switch to dark theme');
  });

  // jsdom ignores @media rules, so the (mobile-only) menu button would stay
  // display:none. Show it the way the <=920px breakpoint does for this test.
  it('mobile menu button exposes and toggles its expanded state from the keyboard', async () => {
    const mobile = document.createElement('style');
    mobile.textContent = 'button[aria-controls] { display: inline-flex !important; }';
    document.head.appendChild(mobile);
    const { user } = renderNav('/');
    const button = screen.getByRole('button', { name: 'Open menu' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const menu = document.getElementById(button.getAttribute('aria-controls')!)!;
    expect(menu).toHaveAttribute('hidden');

    button.focus();
    await user.keyboard('{Enter}');
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveAccessibleName('Close menu');
    expect(menu).not.toHaveAttribute('hidden');
    expect(menu).toHaveAccessibleName('Menu');

    await user.keyboard('{Escape}');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
    mobile.remove();
  });

  it('has a logical tab order (desktop)', async () => {
    const { user } = renderNav('/');
    await expectNamedFocusOrder(user, [
      'BrainBase home',
      'Product',
      'Client Operations',
      'Web Systems',
      'Pricing',
      'Demo',
      'Login',
      'Get Started',
      /Switch to (light|dark) theme/,
    ]);
  });
});
