import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import ClientOperationsDemoPage from '@/app/client-operations/demo/page';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectNamedFocusOrder } from '../../a11y/keyboard';
import { expectNotLiveRegion } from '../../a11y/live-region';

describe('/client-operations/demo', () => {
  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<ClientOperationsDemoPage />, { theme });
    await expectNoAxeViolations(container);
  });

  it('has one h1 and never skips a heading level', () => {
    const { container } = renderBrainbase(<ClientOperationsDemoPage />);
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(h => Number(h.tagName[1]));
    expect(levels.filter(l => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]).toBeLessThanOrEqual(1);
    });
  });

  it('keeps the page copy', () => {
    renderBrainbase(<ClientOperationsDemoPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('See the systembehind the business.');
    for (const text of [
      'Client Operations Demo',
      'Start with what needs attention.',
      'Client Operations Dashboard',
      "Today's Bookings",
      'Never contacted',
      'Private Session',
      'See the week clearly.',
      'Bookings & Sessions',
      'Week of 24–30 August',
      '+ New Booking',
      'The value is what happens between the screens.',
      'HLNΛ adds context',
      'One operation. Multiple connected modules.',
      'The same platform, configured around a real business.',
      'LD Tennis',
      'HLNΛ intelligence layer',
      'The same foundation can be built around your operation.',
    ]) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
    const lede = screen.getByText(/^Explore how BRΛINBΛSE connects leads/);
    expect(lede).toHaveTextContent(
      'Explore how BRΛINBΛSE connects leads, clients, bookings, follow-up and operational visibility for businesses built around customer relationships and service delivery.',
    );
  });

  it('keeps every destination the previous page linked to', () => {
    const { container } = renderBrainbase(<ClientOperationsDemoPage />);
    const main = container.querySelector('main')!;
    const hrefs = [...main.querySelectorAll('a[href]')].map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(
      expect.arrayContaining(['/client-operations', '/request-demo']),
    );
    expect(screen.getByRole('link', { name: '← Back to Client Operations' })).toHaveAttribute('href', '/client-operations');
    expect(screen.getByRole('link', { name: 'Build this for my business' })).toHaveAttribute('href', '/request-demo');
    expect(screen.getByRole('link', { name: 'Back to Client Operations' })).toHaveAttribute('href', '/client-operations');
  });

  it('labels demo and deployment status with static badges, not live regions', () => {
    renderBrainbase(<ClientOperationsDemoPage />);
    for (const label of ['DEMO', 'LIVE DEPLOYMENT']) {
      const badge = screen.getByText(label);
      expect(badge.closest('[data-state]')).not.toBeNull();
      expectNotLiveRegion(badge);
    }
  });

  it('capacity is named for screen readers, not only shown as a ratio', () => {
    const { container } = renderBrainbase(<ClientOperationsDemoPage />);
    const hidden = [...container.querySelectorAll('.bb-visually-hidden')].filter(e => e.textContent === 'Capacity ');
    expect(hidden).toHaveLength(4);
    expect(hidden[1].parentElement).toHaveTextContent('Capacity 8/12');
  });

  it('record types are written in text, not colour alone', () => {
    const { container } = renderBrainbase(<ClientOperationsDemoPage />);
    const types = [...container.querySelectorAll('li')]
      .filter(li => [...li.querySelectorAll('span')].some(span => span.textContent === 'Call'))
      .map(li => li.textContent);
    expect(types).toHaveLength(3);
    expect(types.join(' ')).toMatch(/Lead.*Client.*Lead/);
  });

  it('links are keyboard reachable in a logical order', async () => {
    const { user } = renderBrainbase(<ClientOperationsDemoPage />);
    await expectNamedFocusOrder(user, ['← Back to Client Operations', 'Build this for my business', 'Back to Client Operations']);
  });
});
