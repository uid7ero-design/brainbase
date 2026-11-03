import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { screen, waitFor } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';

// Analytics guard across sign-up → private page → public homepage.
//
// The root layout passes `authenticated={!!session}` to ClarityLoader, but a
// root layout only re-renders on a full load or after a Server Action that
// sets/deletes cookies. Sign-up sets the session in a ROUTE HANDLER, so it
// must finish with a hard navigation — a client-side router.push would keep
// the layout's signed-out state, and the public consent prompt could then
// appear inside the new workspace. jsdom cannot run the server layout, so
// the hard navigation is asserted directly and the post-load layout state is
// rendered explicitly. This is not a browser check.

const nav = vi.hoisted(() => ({ pathname: '/signup', push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, replace: nav.replace, refresh: nav.refresh, prefetch: vi.fn(), back: vi.fn() }),
}));
vi.mock('next/script', () => ({
  default: ({ id }: { id: string }) => <script data-testid={id} />,
}));

import SignupPage from '@/app/signup/page';
import ClarityLoader from '@/components/analytics/ClarityLoader';

const originalLocation = window.location;
let assign: ReturnType<typeof vi.fn>;

function prompt() {
  return screen.queryByRole('region', { name: 'Analytics preference' });
}

beforeEach(() => {
  nav.pathname = '/signup';
  nav.push.mockReset();
  localStorage.clear();
  delete (window as { clarity?: unknown }).clarity;
  assign = vi.fn();
  Object.defineProperty(window, 'location', { value: { ...originalLocation, assign }, writable: true, configurable: true });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
});

afterEach(() => {
  Object.defineProperty(window, 'location', { value: originalLocation, writable: true, configurable: true });
  vi.unstubAllGlobals();
});

async function submitSignup() {
  const view = renderBrainbase(<SignupPage />);
  const { user } = view;
  await user.type(screen.getByLabelText('Full name'), 'Synthetic Person');
  await user.type(screen.getByLabelText('Username'), 'synthetic');
  await user.type(screen.getByLabelText('Work email'), 'synthetic@example.test');
  await user.type(screen.getByLabelText('Organisation'), 'Synthetic Org');
  await user.type(screen.getByLabelText('Password'), 'synthetic-password-1');
  await user.type(screen.getByLabelText('Confirm password'), 'synthetic-password-1');
  await user.click(screen.getByRole('button', { name: /Start free trial/ }));
  return view;
}

describe('sign-up → private page → public homepage', () => {
  it('a successful sign-up ends with a hard navigation to /trial, never a client-side push', async () => {
    await submitSignup();
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/trial'));
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it('a failed sign-up stays on the page and navigates nowhere', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'Username taken' }), { status: 409, headers: { 'Content-Type': 'application/json' } })));
    await submitSignup();
    expect(await screen.findByRole('alert')).toHaveTextContent('Username taken');
    expect(assign).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('after the full load the layout is signed in: no prompt or Clarity on /trial, then none on the public homepage, and no consent is written', () => {
    // State the root layout renders after the hard navigation, with the
    // session cookie now present: authenticated.
    nav.pathname = '/trial';
    const { rerender } = renderBrainbase(<ClarityLoader authenticated />);
    expect(prompt()).toBeNull();
    expect(screen.queryByTestId('microsoft-clarity')).toBeNull();

    // Soft navigation via the workspace header logo to "/": the layout
    // persists, still authenticated.
    nav.pathname = '/';
    rerender(<ClarityLoader authenticated />);
    expect(prompt()).toBeNull();
    expect(screen.queryByTestId('microsoft-clarity')).toBeNull();
    expect(localStorage.getItem('bb-analytics-consent')).toBeNull();
  });

  it('the stale signed-out layout a client-side push would have kept DOES show the prompt on "/" — why the hard navigation matters', () => {
    nav.pathname = '/';
    renderBrainbase(<ClarityLoader authenticated={false} />);
    expect(prompt()).not.toBeNull();
    expect(screen.queryByTestId('microsoft-clarity')).toBeNull();
  });

  it('even with consent previously granted on this browser, a signed-in workspace never starts Clarity', () => {
    localStorage.setItem('bb-analytics-consent', 'granted');
    const clarity = vi.fn();
    (window as { clarity?: unknown }).clarity = clarity;
    nav.pathname = '/';
    renderBrainbase(<ClarityLoader authenticated />);
    expect(screen.queryByTestId('microsoft-clarity')).toBeNull();
    expect(clarity).not.toHaveBeenCalledWith('start');
    expect(localStorage.getItem('bb-analytics-consent')).toBe('granted');
  });
});

describe('every session change re-renders the root layout', () => {
  const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../..', p), 'utf-8');

  it('the root layout derives ClarityLoader’s state from the server session', () => {
    expect(read('app/layout.tsx')).toContain('<ClarityLoader authenticated={!!session} />');
  });

  it('sign-up (route handler sets the cookie) uses a hard navigation and no router', () => {
    const src = read('app/signup/page.tsx');
    expect(src).toContain("window.location.assign('/trial')");
    expect(src).not.toMatch(/router\.(push|replace)\(/);
    expect(src).not.toContain('useRouter');
  });

  it('login and the menu logout are Server Actions that set/delete the session cookie (Next re-renders layouts)', () => {
    const actions = read('app/actions/auth.ts');
    expect(actions.startsWith("'use server'")).toBe(true);
    expect(actions).toMatch(/export async function login[\s\S]*await createSession\(/);
    expect(actions).toMatch(/export async function logout[\s\S]*await deleteSession\(\)/);
    expect(read('app/login/page.tsx')).toContain("useActionState(login");
  });

  it('route-handler logouts: SessionProvider hard-navigates; any stale layout after a logout can only suppress analytics, never enable it', () => {
    // app/data/DataClient.tsx's "Log out and back in" (fetch + router.push) is
    // frozen by the G3 contract tests and left unchanged: a stale layout there
    // keeps authenticated={true}, which hides the prompt and never starts
    // Clarity until the next full load — the safe direction.
    expect(read('components/session/SessionProvider.tsx')).toMatch(/fetch\('\/api\/auth\/logout', \{ method: 'POST' \}\)\.finally\(\(\) => \{\s*window\.location\.replace\('\/login'\)/);
    expect(read('components/analytics/ClarityLoader.tsx')).toContain('const eligible = !authenticated && isClarityAllowedRoute(pathname);');
  });
});
