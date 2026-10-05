import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import PrivacyPage, { metadata as privacyMetadata } from '@/app/privacy/page';
import TermsPage, { metadata as termsMetadata } from '@/app/terms/page';
import { legalSectionId } from '@/components/public/legal/LegalDocument';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

const PAGES = [
  {
    name: 'privacy',
    Page: PrivacyPage,
    h1: 'Privacy Policy',
    sectionCount: 17,
    // Distinctive legal statements that must survive any restyle verbatim.
    phrases: [
      'This Privacy Policy explains how Brainbase (ABN 32 207 559 504), trading as BRΛINBΛSE',
      'Customer Data is not used by BRΛINBΛSE to train general-purpose AI models unless the customer explicitly agrees',
      'Enquiry information may generally be retained for up to 24 months',
      'Customer Data may then be retained for up to 30 days after termination',
      'We currently use Microsoft Clarity, a session-analytics tool',
      'Office of the Australian Information Commissioner (OAIC)',
    ],
    hrefs: ['/', 'mailto:hello@thebrainbase.com.au'],
  },
  {
    name: 'terms',
    Page: TermsPage,
    h1: 'Terms of Use',
    sectionCount: 14,
    phrases: [
      'This Website is operated by Brainbase (ABN 32 207 559 504)',
      'They are not the contract for paid BRΛINBΛSE services.',
      'does not constitute a binding offer',
      'Nothing in these terms excludes, restricts or modifies any consumer guarantee, right or remedy under the Australian Consumer Law',
      'These terms are governed by the laws of South Australia',
    ],
    hrefs: ['/', '/privacy', 'mailto:hello@thebrainbase.com.au'],
  },
] as const;

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

describe.each(PAGES)('/$name legal page', ({ Page, h1, sectionCount, phrases, hrefs }) => {
  it.each(['light', 'dark'] as const)('has no axe violations (%s)', async theme => {
    const { container } = renderBrainbase(<Page />, { theme });
    await expectNoAxeViolations(container);
  });

  it('has exactly one h1 and never skips a heading level', () => {
    const { container } = renderBrainbase(<Page />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(h1);
    const levels = [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(h => Number(h.tagName[1]));
    expect(levels.filter(l => l === 1)).toHaveLength(1);
    expect(levels[0]).toBe(1);
    levels.forEach((level, i) => {
      if (i > 0) expect(level - levels[i - 1]).toBeLessThanOrEqual(1);
    });
  });

  it('keeps the "Last updated" metadata line', () => {
    renderBrainbase(<Page />);
    expect(screen.getByText('Last updated: 24 August 2026')).toBeInTheDocument();
  });

  it('keeps its legal copy verbatim', () => {
    const { container } = renderBrainbase(<Page />);
    const text = norm(container.querySelector('article')?.textContent);
    for (const phrase of phrases) expect(text).toContain(phrase);
  });

  it('renders every numbered section, and each contents link targets a real section', () => {
    const { container } = renderBrainbase(<Page />);
    const sections = container.querySelectorAll('article > section');
    expect(sections).toHaveLength(sectionCount);

    const toc = screen.getByRole('navigation', { name: 'On this page' });
    const links = within(toc).getAllByRole('link');
    expect(links).toHaveLength(sectionCount);
    links.forEach((link, i) => {
      const id = link.getAttribute('href')!.slice(1);
      const target = container.querySelector(`#${CSS.escape(id)}`);
      expect(target, `contents link ${link.textContent} → #${id}`).not.toBeNull();
      expect(target).toBe(sections[i]);
      expect(norm(target!.querySelector('h2')?.textContent)).toBe(norm(link.textContent));
      expect(id).toBe(legalSectionId(norm(link.textContent)));
    });
  });

  it('keeps every destination the page previously linked to', () => {
    const { container } = renderBrainbase(<Page />);
    const found = new Set([...container.querySelectorAll('a[href]')].map(a => a.getAttribute('href')));
    for (const href of hrefs) expect(found).toContain(href);
  });
});

describe('legal page metadata', () => {
  it('keeps the exported titles and descriptions unchanged', () => {
    expect(privacyMetadata).toEqual({
      title: 'Privacy Policy',
      description:
        'How Brainbase (trading as BRΛINBΛSE) collects, uses and protects information across our website and platform.',
    });
    expect(termsMetadata).toEqual({
      title: 'Terms of Use',
      description:
        'The website terms of use for Brainbase (trading as BRΛINBΛSE), covering use of thebrainbase.com.au.',
    });
  });
});
