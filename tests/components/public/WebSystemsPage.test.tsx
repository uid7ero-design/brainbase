import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import WebSystemsPage from '@/app/web-systems/page';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';
import { expectAccessibleName, expectLabelledBy, expectDescribedBy } from '../../a11y/accessibility';
import { expectNotLiveRegion } from '../../a11y/live-region';

describe('/web-systems', () => {
  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<WebSystemsPage />, { theme });
    await expectNoAxeViolations(container);
  });

  it('has one h1 and never skips a heading level', () => {
    const { container } = renderBrainbase(<WebSystemsPage />);
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(h => Number(h.tagName[1]));
    expect(levels.filter(l => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]).toBeLessThanOrEqual(1);
    });
  });

  it('keeps the page copy', () => {
    renderBrainbase(<WebSystemsPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Start with your website.Build the system behind it.',
    );
    for (const text of [
      "Your website shouldn't stop at the inbox.",
      'From website visitor to organised operation.',
      'More than a website.',
      'Make the website useful after the form is submitted.',
      'Built to connect with the operation behind it.',
      'Start with the front door.',
      'Connect the systems that already make sense.',
      'LD Tennis',
      'Start where it makes sense.',
      'From idea to live system.',
      'We can stay responsible after launch.',
      'The website can be the starting point.',
      'Turn your website into part of the operation.',
      'Microsoft 365 — external system example',
      'The website is only the front door.',
    ]) {
      expect(screen.getAllByText(text).length, text).toBeGreaterThan(0);
    }
    // Mixed inline markup: the space after the accented word was dropped by
    // the production JSX transform when the text wrapped onto a new line.
    const frontDoor = [...document.querySelectorAll('p')].find(p => p.textContent?.startsWith('The website is the front door.'));
    expect(frontDoor?.textContent).toBe("The website is the front door. BRΛINBΛSE is what's behind it.");
  });

  it('keeps every destination the previous page linked to', () => {
    const { container } = renderBrainbase(<WebSystemsPage />);
    const hrefs = new Set([...container.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
    for (const href of [
      '/',
      '/client-operations',
      '/client-operations/demo',
      '/demo',
      '/pricing',
      '/privacy',
      '/request-demo',
      '/terms',
      'https://ldtennis.com.au',
    ]) {
      expect(hrefs, href).toContain(href);
    }
    expect(container.querySelector('#what-we-build')).not.toBeNull();
  });

  it('the external LD Tennis link says it opens a new tab', () => {
    renderBrainbase(<WebSystemsPage />);
    const link = screen.getByRole('link', { name: /View LD Tennis/ });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expectAccessibleName(link, 'View LD Tennis (opens in a new tab)');
  });

  it('static badges are not live regions', () => {
    renderBrainbase(<WebSystemsPage />);
    expectNotLiveRegion(screen.getByText('Recommended'));
    expectNotLiveRegion(screen.getByText('Real deployment'));
  });

  it('a deployment option opens the enquiry dialog from the keyboard, and Escape closes it and restores focus', async () => {
    const { user } = renderBrainbase(<WebSystemsPage />);
    const trigger = screen.getByRole('button', { name: 'Discuss your system' });
    trigger.focus();
    await user.keyboard('{Enter}');

    const dialog = screen.getByRole('dialog', { name: 'Book a Strategy Call' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expectLabelledBy(dialog, within(dialog).getByRole('heading', { name: 'Book a Strategy Call' }));
    expectDescribedBy(
      dialog,
      within(dialog).getByText("Tell us about your business and we'll get back to you within 1–2 business days."),
    );
    expect(dialog.contains(document.activeElement)).toBe(true);
    await expectNoAxeViolations(dialog);

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('enquiry fields are labelled and validation errors are associated with them', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { user } = renderBrainbase(<WebSystemsPage />);
    await user.click(screen.getByRole('button', { name: 'Discuss your website' }));
    const dialog = screen.getByRole('dialog');

    expect(within(dialog).getByLabelText(/Full Name/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Email Address/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close enquiry form' })).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Book Strategy Call →' }));
    const name = within(dialog).getByLabelText(/Full Name/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Name is required');
    expect(within(dialog).getByLabelText(/Email Address/)).toHaveAccessibleDescription('Email is required');
    // Validation still blocks submission exactly as before.
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('service toggles expose their pressed state', async () => {
    const { user } = renderBrainbase(<WebSystemsPage />);
    await user.click(screen.getByRole('button', { name: 'Request deployment review' }));
    const toggle = within(screen.getByRole('dialog')).getByRole('button', { name: 'AI-Powered Website' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
});
