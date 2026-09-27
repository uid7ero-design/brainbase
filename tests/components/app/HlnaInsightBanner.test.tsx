import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Authenticated visual-completion pass (P3 follow-up) — Helena's insight
// banner above the Fleet, Waste and Service Requests dashboards. Converged
// from old-violet/white-alpha dark literals to theme tokens; the fetch,
// store and prompt contract is unchanged.

const fireHelena = vi.fn();
const setOrbAlert = vi.fn();
const setChatOpen = vi.fn();
vi.mock('@/lib/state/useAppStore', () => {
  const useAppStore = () => ({ fireHelena, setOrbAlert });
  useAppStore.getState = () => ({ setChatOpen });
  return { useAppStore };
});

import { HlnaInsightBanner } from '@/components/hlna/InsightBanner';

const INSIGHT = {
  headline: 'Contamination rose in the northern zones',
  trend: '+4.2%', trendDir: 'up', trendPositive: false,
  anomaly: 'Zone 3 recycling contamination doubled last week',
  recommendation: 'Schedule bin audits for zone 3',
  confidence: 'Medium', rowsAnalysed: 12840, hasData: true,
  timestamp: new Date(Date.now() - 90_000).toISOString(),
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fireHelena.mockReset(); setOrbAlert.mockReset(); setChatOpen.mockReset();
  fetchMock = vi.fn(async () => new Response(JSON.stringify(INSIGHT), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});

describe.each(['light', 'dark'] as const)('HlnaInsightBanner (%s)', theme => {
  it('loads the insight with the unchanged request and renders it accessibly', async () => {
    const { container } = renderBrainbase(<HlnaInsightBanner dashboardType="waste" />, { theme });
    await screen.findByText(INSIGHT.headline);
    expect(fetchMock).toHaveBeenCalledWith('/api/hlna/insight', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dashboardType: 'waste' }),
    });
    expect(setOrbAlert).toHaveBeenCalledWith(true);
    expect(screen.getByText(/HLNΛ · Waste Operations Insight/)).toBeTruthy();
    expect(screen.getByText('↑ +4.2%')).toBeTruthy();
    expect(screen.getByText(INSIGHT.anomaly)).toBeTruthy();
    expect(screen.getByText('waste_records')).toBeTruthy();
    expect(screen.getByText('Full financial year')).toBeTruthy();
    expect(screen.getByText((12840).toLocaleString())).toBeTruthy();
    expect(screen.getByText('Medium')).toBeTruthy();
    // Relative timestamp is set by an effect after the insight renders (fixture is
    // ≥90s old; exact minutes depend on suite load), so wait for it.
    expect(await screen.findByText(/Updated \d+m ago/)).toBeTruthy();
    // No literal colours left inline — everything paints through tokens.
    for (const el of Array.from(container.querySelectorAll<HTMLElement>('[style]')))
      expect(el.getAttribute('style') ?? '').not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    await expectNoAxeViolations(container);
  });

  it('refresh is a named button that re-requests the insight', async () => {
    renderBrainbase(<HlnaInsightBanner dashboardType="fleet" />, { theme });
    await screen.findByText(INSIGHT.headline);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh insight' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it('Ask HLNΛ sends the unchanged prompt and opens chat', async () => {
    renderBrainbase(<HlnaInsightBanner dashboardType="service_requests" />, { theme });
    await screen.findByText(INSIGHT.headline);
    fireEvent.click(screen.getByRole('button', { name: 'Ask HLNΛ →' }));
    expect(fireHelena).toHaveBeenCalledWith(
      `Based on the current Service Requests data, ${INSIGHT.headline.toLowerCase()} The main anomaly is: ${INSIGHT.anomaly}. Give me a detailed analysis and recommended actions.`);
    expect(setChatOpen).toHaveBeenCalledWith(true);
  });

  it('renders nothing when there is no data, and nothing on error', async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ ...INSIGHT, hasData: false }), { status: 200 }));
    const a = renderBrainbase(<HlnaInsightBanner dashboardType="waste" />, { theme });
    await waitFor(() => expect(a.container.querySelector('[aria-hidden="true"]')).toBeNull());
    expect(a.container.textContent).toBe('');
    a.unmount();
    fetchMock.mockImplementationOnce(async () => { throw new Error('offline'); });
    const b = renderBrainbase(<HlnaInsightBanner dashboardType="waste" />, { theme });
    await waitFor(() => expect(b.container.textContent).toBe(''));
  });
});
