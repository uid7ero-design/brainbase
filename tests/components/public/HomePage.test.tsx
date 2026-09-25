import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import Home from '@/app/page';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectNotLiveRegion } from '../../a11y/live-region';

describe('Public homepage', () => {
  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<Home />, { theme });
    await expectNoAxeViolations(container);
  });

  it('has one h1 and never skips a heading level', () => {
    const { container } = renderBrainbase(<Home />);
    const headings = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(h => Number(h.tagName[1]));
    expect(headings.filter(l => l === 1)).toHaveLength(1);
    expect(headings[0]).toBe(1);
    headings.forEach((level, i) => {
      if (i > 0) expect(level - headings[i - 1]).toBeLessThanOrEqual(1);
    });
  });

  it('keeps the hero headline and product copy', () => {
    renderBrainbase(<Home />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'One platform.Built around howyour business works.',
    );
    for (const text of [
      'Clients & CRM',
      'Events & Ticketing',
      'LD Tennis',
      'Capture. Organise. Operate. Understand.',
      "Tell us what you're trying to improve.",
    ]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
  });

  it('keeps every destination the previous homepage linked to', () => {
    const { container } = renderBrainbase(<Home />);
    const hrefs = new Set([...container.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
    for (const href of [
      '/demo',
      '/request-demo',
      '/client-operations',
      '/client-operations/demo',
      '/web-systems',
      '/pricing',
      '/terms',
      '/privacy',
    ]) {
      expect(hrefs).toContain(href);
    }
  });

  it('keeps the #product anchor the public nav points at', () => {
    const { container } = renderBrainbase(<Home />);
    expect(container.querySelector('#product')).not.toBeNull();
  });

  it('static status badges are not live regions', () => {
    renderBrainbase(<Home />);
    expectNotLiveRegion(screen.getByText('Real deployment'));
  });

  it('decorative graphics are silent: every SVG is aria-hidden or a named image', () => {
    const { container } = renderBrainbase(<Home />);
    const svgs = [...container.querySelectorAll('svg')];
    expect(svgs.length).toBeGreaterThan(10);
    for (const svg of svgs) {
      if (svg.closest('[aria-hidden="true"]')) continue;
      expect(svg.getAttribute('role'), svg.outerHTML.slice(0, 80)).toBe('img');
      expect(svg).toHaveAccessibleName();
    }
    expect(screen.getByRole('img', { name: 'BRΛINBΛSE platform map' })).toHaveAccessibleDescription(
      /Microsoft 365 shown as an example connected external system/,
    );
  });

  it('footer content is preserved: wordmark, links, copyright, studio line', () => {
    renderBrainbase(<Home />);
    const footer = screen.getByRole('contentinfo');
    expect(footer).toContainElement(screen.getAllByRole('img', { name: 'BRΛINBΛSE' })[0]);
    expect(footer).toHaveTextContent('One connected operational platform.');
    expect(footer).toHaveTextContent('© 2026 BRΛINBΛSE');
    expect(footer).toHaveTextContent('A product from HLNA Labs');
    const hrefs = [...footer.querySelectorAll('a')].map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['/client-operations', '/web-systems', '/pricing', '/demo', '/terms', '/privacy']);
    expect(footer.querySelector('a[href*="hlnalabs"]')).toBeNull();
  });

  it('labels the HLNΛ query input', () => {
    renderBrainbase(<Home />);
    expect(screen.getByRole('textbox', { name: 'Ask HLNΛ a question' })).toBeInTheDocument();
  });
});
