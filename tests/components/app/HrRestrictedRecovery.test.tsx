import { Suspense } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import Page from '@/app/people/restricted-cases/[id]/page';

afterEach(() => vi.unstubAllGlobals());
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function renderPage() {
  await act(async () => {
    renderBrainbase(<Suspense fallback={<div>Starting</div>}><Page params={Promise.resolve({ id })} /></Suspense>);
  });
}
it.each(['network', 'partial'] as const)('recovers safely from %s restricted reads', async failure => {
  let fail = true;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (fail && failure === 'network') throw new Error('sensitive connection detail');
    if (fail && url.endsWith('/notes')) return new Response('{"error":"sensitive case detail"}', { status: 403 });
    const body = url.endsWith('/participants') ? { participants: [] }
      : url.endsWith('/notes') ? { notes: [] } : url.endsWith('/documents') ? { documents: [] }
      : url.endsWith('/people') ? { people: [] } : url.endsWith('/administrators') ? { users: [] }
      : { case: { id, title: 'Synthetic restricted case', case_type: 'other', status: 'OPEN', reference: null } };
    return new Response(JSON.stringify(body), { status: 200 });
  }));
  await renderPage();
  expect(await screen.findByText('Could not load restricted HR case. Refresh to try again.')).toBeTruthy();
  expect(screen.queryByText('Synthetic restricted case')).toBeNull();
  expect(document.body.textContent).not.toContain('sensitive');
  fail = false; fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('Synthetic restricted case')).toBeTruthy();
});
