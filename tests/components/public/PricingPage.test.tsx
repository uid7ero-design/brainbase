import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import PricingPage from '@/app/pricing/page';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectNotLiveRegion } from '../../a11y/live-region';
import { expectSemanticState } from '../../a11y/semantic-state';

describe('Public pricing page', () => {
  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<PricingPage />, { theme });
    await expectNoAxeViolations(container);
  });

  it('has one h1 and never skips a heading level', () => {
    const { container } = renderBrainbase(<PricingPage />);
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(h => Number(h.tagName[1]));
    expect(levels.filter(l => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]).toBeLessThanOrEqual(1);
    });
  });

  it('keeps every plan, price and CTA', () => {
    renderBrainbase(<PricingPage />);
    for (const [name, price, cta] of [
      ['Foundation', '$29', 'Discuss Foundation'],
      ['Operations', '$59', 'Discuss Operations'],
      ['Business System', '$99', 'Discuss Business System'],
      ['Enterprise', 'Custom', 'Talk to us'],
    ]) {
      const plan = screen.getByRole('heading', { level: 2, name }).closest('li')!;
      expect(within(plan).getByText(price)).toBeInTheDocument();
      expect(within(plan).getByRole('link', { name: cta })).toHaveAttribute('href', '/request-demo');
    }
    expect(screen.getAllByText('/ month')).toHaveLength(3);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Start with what you need.Expand as your operation grows.',
    );
  });

  it('keeps every destination the previous page linked to', () => {
    const { container } = renderBrainbase(<PricingPage />);
    const hrefs = new Set([...container.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
    for (const href of ['/client-operations', '/demo', '/privacy', '/request-demo', '/terms', '/web-systems']) {
      expect(hrefs).toContain(href);
    }
  });

  it('plan statuses carry visible text, not colour alone, and are not live regions', () => {
    renderBrainbase(<PricingPage />);
    for (const [text, state] of [
      ['Most Popular', 'active'],
      ['Tailored', 'info'],
    ] as const) {
      const badge = screen.getByText(text).closest('[data-state]')!;
      expectSemanticState(badge, state, text);
      expectNotLiveRegion(badge);
    }
  });

  it('the comparison is a real table whose cells say Included / Not included in text', () => {
    renderBrainbase(<PricingPage />);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('columnheader').map(h => h.textContent)).toEqual([
      'Capability',
      'Foundation',
      'Operations',
      'Business System',
      'Enterprise',
    ]);
    const row = within(table).getByRole('rowheader', { name: 'HLNA intelligence' }).closest('tr')!;
    expect([...row.querySelectorAll('td')].map(td => td.textContent?.replace('—', '').trim())).toEqual([
      'Not included',
      'Not included',
      'Included',
      'Included',
    ]);
  });

  it('the horizontally scrollable table region is keyboard-focusable and named', () => {
    renderBrainbase(<PricingPage />);
    const region = screen.getByRole('region', { name: 'Plan comparison table' });
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('uses plain BrainBase / HLNA in readable text — no stylised Λ outside hidden marks', () => {
    const { container } = renderBrainbase(<PricingPage />);
    const clone = container.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('[aria-hidden="true"]').forEach(n => n.remove());
    expect(clone.textContent).not.toMatch(/Λ/);
    expect(clone.textContent).toMatch(/BrainBase pricing reflects/);
    for (const el of container.querySelectorAll('[aria-label]')) {
      expect(el.getAttribute('aria-label')).not.toMatch(/Λ/);
    }
  });

  it('every section header uses the shared numbered pattern, in order', () => {
    const { container } = renderBrainbase(<PricingPage />);
    const indexes = [...container.querySelectorAll('h2')]
      .map(h => h.previousElementSibling?.querySelector('span')?.textContent)
      .filter((t): t is string => !!t && /^\d{2}$/.test(t));
    expect(indexes).toEqual(['01', '02', '03', '04', '05']);
  });
});
