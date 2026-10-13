import { Suspense } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import Page from '@/app/people/restricted-cases/[id]/page';
import ListPage from '@/app/people/restricted-cases/page';

afterEach(() => vi.unstubAllGlobals());
it('recovers the restricted list after a network failure without exposing the failure', async () => {
  let fail = true;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    if (fail) throw new Error('sensitive connection detail');
    const url = String(input);
    return new Response(JSON.stringify(url.endsWith('/restricted-cases') ? { cases: [] }
      : url.endsWith('/administrators') ? { users: [] } : {}));
  }));
  await act(async () => { renderBrainbase(<ListPage />); });
  expect(await screen.findByText('Could not load restricted HR cases. Refresh to try again.')).toBeTruthy();
  expect(document.body.textContent).not.toContain('sensitive');
  expect(screen.queryByRole('button', { name: '+ Open Case' })).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('No restricted cases are currently available to you.')).toBeTruthy();
});
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

it.each(['denied', 'malformed'] as const)('keeps restricted list capabilities closed after %s response', async failure => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/restricted-cases')) return failure === 'denied'
      ? new Response('{"error":"sensitive denial"}', { status: 403 })
      : new Response('{"cases":[{}]}');
    return new Response(JSON.stringify(url.endsWith('/administrators') ? { users: [] } : { userId: id }));
  }));
  await act(async () => { renderBrainbase(<ListPage />); });
  expect(await screen.findByText('Could not load restricted HR cases. Refresh to try again.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '+ Open Case' })).toBeNull();
  expect(document.body.textContent).not.toContain('sensitive');
});

it('does not commit a late restricted read into a remounted page', async () => {
  let release!: (response: Response) => void;
  let first = true;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/restricted-cases') && first) {
      first = false;
      return new Promise<Response>(resolve => { release = resolve; });
    }
    return new Response(JSON.stringify(url.endsWith('/restricted-cases') ? { cases: [] }
      : url.endsWith('/administrators') ? { users: [] } : {}));
  }));
  let firstPage!: ReturnType<typeof renderBrainbase>;
  await act(async () => { firstPage = renderBrainbase(<ListPage />); });
  firstPage.unmount();
  await act(async () => { renderBrainbase(<ListPage />); });
  expect(await screen.findByText('No restricted cases are currently available to you.')).toBeTruthy();
  await act(async () => { release(new Response(JSON.stringify({ cases: [{ id, title: 'Obsolete sensitive case', case_type: 'other', reference: null }] }))); });
  expect(screen.queryByText('Obsolete sensitive case')).toBeNull();
});

it.each(['lost', 'server', 'malformed'] as const)('locks an uncertain %s note write until a fresh read without replay', async failure => {
  let writes = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST') {
      writes++;
      if (failure === 'server') return new Response('{}', { status: 500 });
      if (failure === 'malformed') return new Response('broken');
      throw new Error('Lost response after commit');
    }
    const body = url.endsWith('/participants') ? { participants: [] }
      : url.endsWith('/notes') ? { notes: writes ? [{ id: 'note', body: 'Synthetic note', author_id: id, created_at: '2026-10-13' }] : [] }
      : url.endsWith('/documents') ? { documents: [] } : url.endsWith('/people') ? { people: [] }
      : url.endsWith('/administrators') ? { users: [] }
      : { case: { id, title: 'Synthetic case', case_type: 'other', status: 'open', reference: null } };
    return new Response(JSON.stringify(body));
  }));
  await renderPage();
  fireEvent.change(await screen.findByRole('textbox', { name: 'New case note' }), { target: { value: 'Synthetic note' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
  expect(await screen.findByText('The change could not be confirmed. Refresh and review the case before trying again.')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Add note' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('textbox', { name: 'New case note' }) as HTMLTextAreaElement).value).toBe('Synthetic note');
  fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
  expect(writes).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByText('Synthetic note')).toBeTruthy();
  expect(writes).toBe(1);
});

it('preserves a case draft and prevents replay after a lost creation response', async () => {
  let writes = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === 'POST') { writes++; throw new Error('Lost creation response'); }
    const url = String(input);
    return new Response(JSON.stringify(url.endsWith('/restricted-cases') ? { cases: [] }
      : url.endsWith('/administrators') ? { users: [] } : {}));
  }));
  await act(async () => { renderBrainbase(<ListPage />); });
  fireEvent.click(await screen.findByRole('button', { name: '+ Open Case' }));
  fireEvent.change(screen.getByRole('textbox', { name: /Title/ }), { target: { value: 'Synthetic draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Open Case', exact: true }));
  expect(await screen.findByText('The change could not be confirmed. Do not open this case again until its creation and access have been checked.')).toBeTruthy();
  expect((screen.getByRole('textbox', { name: /Title/ }) as HTMLInputElement).value).toBe('Synthetic draft');
  expect((screen.getByRole('button', { name: 'Open Case', exact: true }) as HTMLButtonElement).disabled).toBe(true);
  expect(writes).toBe(1);
  fireEvent.click(screen.getByRole('button', { name: 'Close Open Restricted Case' }));
  expect((screen.getByRole('button', { name: '+ Open Case' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('No restricted cases are currently available to you.');
  expect((screen.getByRole('button', { name: '+ Open Case' }) as HTMLButtonElement).disabled).toBe(true);
  expect(writes).toBe(1);
});
