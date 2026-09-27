import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Authenticated visual-completion pass (P5) — the tennis tenant dashboard
// rendered for real in light AND dark with mock data. It previously
// injected a fixed #08090c page slab with white-alpha text. The async
// server-only news panel is stubbed; the weather and briefing fetches are
// answered with fixtures.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/dashboard',
  useSearchParams: () => new URLSearchParams(''),
}));
vi.mock('@/components/dashboard/TennisNewsPanel', () => ({
  default: () => <section aria-label="Tennis news"><h2>Tennis News</h2></section>,
}));

class RO { observe() {} unobserve() {} disconnect() {} }
vi.stubGlobal('ResizeObserver', RO);

const { default: TennisDashboard } = await import('@/components/dashboard/TennisDashboard');

const iso = (d: number) => new Date(Date.now() - d * 86400000).toISOString();

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/hlna/briefing')) {
      return new Response(JSON.stringify({ lines: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }));
});

const PROPS = {
  greeting: 'Good morning, Coach',
  stats: { todaysSessions: 3, newThisWeek: 5, activeLeads: 7, needsFollowup: 2 },
  recentLeads: [
    { id: 'l1', name: 'Isla Brown', email: 'isla@example.test', status: 'new', session_type: 'Private lesson', created_at: iso(1) },
    { id: 'l2', name: 'Jack Wilson', email: 'jack@example.test', status: 'booked', session_type: null, created_at: iso(3) },
  ],
  attentionContacts: [
    { id: 'c1', name: 'Mia Roberts', email: 'mia@example.test', phone: '0400 111 222', status: 'active', last_contacted_at: null },
  ],
  leadsPerDay: [
    { day: 'Mon', leads: 1 }, { day: 'Tue', leads: 0 }, { day: 'Wed', leads: 2 }, { day: 'Thu', leads: 0 },
    { day: 'Fri', leads: 1 }, { day: 'Sat', leads: 3 }, { day: 'Sun', leads: 0 },
  ],
  todaysSessions: [
    { id: 'i1', session_id: 's1', date: '2026-09-27', start_time: '16:00', duration_minutes: 60, max_capacity: 8,
      status: 'scheduled', session_name: 'Hot Shots', session_type: 'JUNIOR_SQUAD', resource_id: null,
      session_colour_key: null, enrolled_count: 6 },
  ],
  sessionTypes: [],
  enabledCapabilities: [],
};

describe.each(['light', 'dark'] as const)('TennisDashboard (%s)', theme => {
  it('renders stats, leads, follow-ups and today\'s sessions with no near-white inline colour, and no axe violations', async () => {
    const { container } = renderBrainbase(<TennisDashboard {...PROPS} />, { theme });
    expect(screen.getByText('Good morning, Coach')).toBeInTheDocument();
    for (const v of ['3', '5', '7', '2']) expect(screen.getAllByText(v).length).toBeGreaterThan(0);
    for (const n of ['Isla Brown', 'Jack Wilson', 'Mia Roberts', 'Hot Shots']) {
      expect(screen.getAllByText(n).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('link', { name: /Call Mia Roberts/ })).toBeInTheDocument();
    // The HLNΛ header mark is the static, decorative BrokenOrbitMark.
    expect(container.querySelector('svg[aria-hidden="true"][viewBox="0 0 100 100"]')).not.toBeNull();

    const offenders: string[] = [];
    for (const el of Array.from(container.querySelectorAll<HTMLElement>('*'))) {
      for (const prop of ['color', 'backgroundColor'] as const) {
        const m = el.style[prop].match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (m && [m[1], m[2], m[3]].map(Number).every(c => c >= 230)) offenders.push(`${el.tagName} ${prop}`);
        if (m && prop === 'backgroundColor' && [m[1], m[2], m[3]].map(Number).every(c => c <= 20)) offenders.push(`${el.tagName} dark slab`);
      }
    }
    expect(offenders).toEqual([]);
    await expectNoAxeViolations(container);
    expect(within(container).queryByText(/undefined/)).toBeNull();
  });
});
