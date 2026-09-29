import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Remaining visual islands — residue follow-up. The welcome-back banner is
// rendered through the real SessionProvider path: a tab hidden for more than
// five minutes and then shown again. It is checked in light and dark, and the
// test asserts that the timing, the copy and the 3.5 s auto-dismiss are
// unchanged. Token and colour rules are pinned by
// tests/containment/remainingVisualResidue.test.ts.

vi.mock('@/components/session/LockScreen', () => ({ default: () => null }));
const { default: SessionProvider } = await import('@/components/session/SessionProvider');

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => visibility === 'hidden' });
  // An existing tab marker, so the provider's closed-tab logout branch does not run.
  sessionStorage.setItem('hlna_tab', '1');
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

function awayAndBack(ms: number) {
  act(() => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); });
  act(() => { vi.setSystemTime(Date.now() + ms); });
  act(() => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); });
}

describe.each(['light', 'dark'] as const)('WelcomeBackBanner (%s)', theme => {
  it('appears after more than five minutes away, reads "Welcome back, <first name>" and passes axe', async () => {
    const { container } = renderBrainbase(
      <SessionProvider hasSession name="Alex Example" secureModeDefault={false}><main><h1>Page</h1></main></SessionProvider>,
      { theme },
    );
    expect(screen.queryByText(/Welcome back/)).toBeNull();
    awayAndBack(6 * 60 * 1000);
    const text = screen.getByText(/Welcome back,/);
    expect(text.textContent).toBe('Welcome back, Alex');
    expect(screen.getByText('Alex').className).toMatch(/name/);
    const banner = text.parentElement as HTMLElement;
    expect(banner.className).toMatch(/banner/);
    expect(banner.getAttribute('style')).toBeNull();
    expect(banner.querySelector('[aria-hidden="true"]')).not.toBeNull();
    vi.useRealTimers();
    await expectNoAxeViolations(container);
  });
});

describe('WelcomeBackBanner behaviour is unchanged', () => {
  it('does not appear after a short absence', () => {
    renderBrainbase(<SessionProvider hasSession name="Alex Example" secureModeDefault={false}><div /></SessionProvider>);
    awayAndBack(4 * 60 * 1000);
    expect(screen.queryByText(/Welcome back/)).toBeNull();
  });

  it('auto-dismisses after 3.5 s', () => {
    renderBrainbase(<SessionProvider hasSession name="Alex Example" secureModeDefault={false}><div /></SessionProvider>);
    awayAndBack(6 * 60 * 1000);
    expect(screen.getByText(/Welcome back,/)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3499); });
    expect(screen.queryByText(/Welcome back,/)).not.toBeNull();
    act(() => { vi.advanceTimersByTime(2); });
    expect(screen.queryByText(/Welcome back,/)).toBeNull();
  });

  it('never renders without a session', () => {
    renderBrainbase(<SessionProvider hasSession={false} name="Alex Example" secureModeDefault={false}><div /></SessionProvider>);
    awayAndBack(6 * 60 * 1000);
    expect(screen.queryByText(/Welcome back/)).toBeNull();
  });
});
