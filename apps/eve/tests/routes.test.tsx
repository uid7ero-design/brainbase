import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { axe } from 'jest-axe';
import type { ReactElement } from 'react';

import MarketingLayout from '@/app/(marketing)/layout';
import HomePage from '@/app/(marketing)/page';
import FeaturesPage from '@/app/(marketing)/features/page';
import PricingPage from '@/app/(marketing)/pricing/page';
import OrganisersPage from '@/app/(marketing)/organisers/page';
import VenuesPage from '@/app/(marketing)/venues/page';
import GetStartedPage from '@/app/(marketing)/get-started/page';
import NotFound from '@/app/not-found';
import { MARKETING_LINKS } from '@/components/marketing/MarketingNav';
import { impactPlaceholder } from '@/content/impact';

// Words that would mean another product's shell leaked into this one, and
// claims that are not yet true and must not be made.
const FOREIGN_CHROME = /BrainBase|Brainbase|Data Hub|Operations Intelligence|Command Centre|Founder OS|Assurance|Helena/;
const UNSUPPORTED_CLAIMS = /cheapest|better than|100%|profits? (to|donated)|charity|reserved seating|offline scanning|Humanitix|Oztix|Moshtix/i;

const MARKETING: [string, ReactElement][] = [
  ['/', <HomePage key="home" />],
  ['/features', <FeaturesPage key="f" />],
  ['/pricing', <PricingPage key="p" />],
  ['/organisers', <OrganisersPage key="o" />],
  ['/venues', <VenuesPage key="v" />],
  ['/get-started', <GetStartedPage key="g" />],
  ['/404', <NotFound key="n" />],
];

describe('marketing shell', () => {
  for (const [path, page] of MARKETING) {
    it(`${path} renders inside the marketing layout, with no foreign chrome, no unsupported claims, and no axe violations`, async () => {
      const wrapped = path === '/404' ? page : <MarketingLayout>{page}</MarketingLayout>;
      const { container } = render(wrapped);
      expect(container.textContent).not.toMatch(FOREIGN_CHROME);
      expect(container.textContent).not.toMatch(UNSUPPORTED_CLAIMS);
      expect(screen.getAllByRole('link', { name: /eve home/i }).length).toBeGreaterThan(0);
      expect(container.querySelector('main#main')).not.toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    });
  }

  it('the home hero carries the tagline with the "Eve" highlighted inside "Events", and the restrained V1 copy', () => {
    const { container } = render(<MarketingLayout><HomePage /></MarketingLayout>);
    const h1 = container.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1!.querySelector('.sr-only')?.textContent).toBe('Events made easy');
    const visual = h1!.querySelector('[aria-hidden="true"]');
    expect(visual?.textContent).toBe('Events made easy');
    expect(visual?.querySelector('.text-eve-accent')?.textContent).toBe('Eve');
    expect(container.textContent).toContain('Ticketing built for every kind of event.');
    expect(container.textContent).toContain('Create, sell, scan and manage — without the complexity.');
  });

  it('primary navigation links every marketing route plus sign-in and the create-event CTA', () => {
    render(<MarketingLayout><HomePage /></MarketingLayout>);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    for (const l of MARKETING_LINKS) expect(within(nav).getByRole('link', { name: l.label })).toHaveAttribute('href', l.href);
    expect(screen.getAllByRole('link', { name: /sign in/i })[0]).toHaveAttribute('href', '/signin');
    expect(screen.getAllByRole('link', { name: /create an event/i })[0]).toHaveAttribute('href', '/get-started');
  });

  it('pricing and get-started are explicit "not yet available" panels, never forms or numbers', () => {
    for (const page of [<PricingPage key="p" />, <GetStartedPage key="g" />]) {
      const { container, unmount } = render(page);
      expect(container.querySelector('[data-eve-unavailable="true"]')).not.toBeNull();
      expect(container.querySelector('input, form, button[type="submit"]')).toBeNull();
      expect(container.textContent).not.toMatch(/\$\s?\d|\d+(\.\d+)?%/);
      unmount();
    }
  });
});

describe('content guards', () => {
  it('the social-impact placeholder is disabled and never rendered', () => {
    expect(impactPlaceholder.enabled).toBe(false);
    for (const [, page] of MARKETING) {
      const { container, unmount } = render(page);
      expect(container.textContent).not.toMatch(/domestic|family violence|not-for-profit|charit/i);
      unmount();
    }
  });
});
