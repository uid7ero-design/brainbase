import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import ClientOperations from '@/app/client-operations/page';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectNotLiveRegion } from '../../a11y/live-region';

describe('Public /client-operations page', () => {
  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<ClientOperations />, { theme });
    await expectNoAxeViolations(container);
  });

  it('has one h1 and never skips a heading level', () => {
    const { container } = renderBrainbase(<ClientOperations />);
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(h => Number(h.tagName[1]));
    expect(levels.filter(l => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]).toBeLessThanOrEqual(1);
    });
  });

  it('keeps the hero headline and key product copy', () => {
    renderBrainbase(<ClientOperations />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Run the client journeyin one connected place.',
    );
    for (const text of [
      "Your client journey shouldn't depend on manual hand-offs.",
      'From first enquiry to ongoing client.',
      'Less admin. More control.',
      'The capabilities behind Client Operations.',
      'Operational Dashboard',
      'LD Tennis',
      'Start here. Expand when you need to.',
      'Start small. Expand as you connect more.',
      'Bring your client operation together.',
      'Platform subscription + implementation where required.',
      'Microsoft 365 — external system example',
    ]) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
  });

  it('keeps all four plans, their prices and their CTAs', () => {
    renderBrainbase(<ClientOperations />);
    for (const [name, price, cta] of [
      ['Foundation', '$29', 'Discuss Foundation'],
      ['Operations', '$59', 'Discuss Operations'],
      ['Business System', '$99', 'Discuss Business System'],
      ['Enterprise', 'Custom', 'Talk to us'],
    ]) {
      const plan = screen.getByRole('heading', { level: 3, name }).closest('li')!;
      expect(within(plan).getByText(price)).toBeInTheDocument();
      expect(within(plan).getByRole('link', { name: cta })).toHaveAttribute('href', '/request-demo');
    }
    expect(screen.getByText('MOST POPULAR')).toBeInTheDocument();
    expect(screen.getByText('TAILORED')).toBeInTheDocument();
  });

  it('keeps every destination the previous page linked to', () => {
    const { container } = renderBrainbase(<ClientOperations />);
    const hrefs = new Set([...container.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
    for (const href of ['/', '/client-operations/demo', '/request-demo', '/pricing', '/privacy', '/terms']) {
      expect(hrefs, href).toContain(href);
    }
    expect(screen.getByRole('link', { name: '← Back to BRΛINBΛSE' })).toHaveAttribute('href', '/');
  });

  it('renders the theme-aware lockup, not the dark-only wordmark image', () => {
    const { container } = renderBrainbase(<ClientOperations />);
    expect(screen.getAllByRole('img', { name: 'BRΛINBΛSE' }).length).toBeGreaterThan(0);
    expect(container.querySelector('img[src*="brainbase-horizontal-color"]')).toBeNull();
  });

  it('static status badges are not live regions', () => {
    renderBrainbase(<ClientOperations />);
    for (const text of ['EXAMPLE VIEW', 'Real deployment', 'MOST POPULAR']) {
      expectNotLiveRegion(screen.getByText(text));
    }
  });

  it('every link is reachable by keyboard (no negative tabindex, all have names)', () => {
    renderBrainbase(<ClientOperations />);
    for (const link of screen.getAllByRole('link')) {
      expect(link).not.toHaveAttribute('tabindex', '-1');
      expect(link).toHaveAccessibleName();
    }
  });
});
