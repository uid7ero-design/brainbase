import type { ReactNode } from 'react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import Drawer from '@/app/people/_components/PersonDrawer';
vi.mock('@/app/people/_components/SlidePanel', () => ({ default: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <section>{children}</section> : null }));
vi.mock('@/app/people/_components/PersonAiAssistant', () => ({ default: ({ personId }: { personId: string }) => <span>Assistant {personId}</span> }));
const person = (id: string) => ({ id, first_name: id, last_name: 'Fixture', job_title: null, worker_type: 'employee', employment_status: 'active' });
const fetchMock = vi.fn();
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => Promise.resolve(url.includes('/documents') ? response({}, 403)
    : url.includes('/workflows') ? response({ workflows: [], capabilities: { can_start_workflow: false } }) : response({ person: person(url.split('/').at(-1)!) })));
});
afterEach(() => vi.unstubAllGlobals());
const props = { canManage: false, onClose: vi.fn(), onEdit: vi.fn() };
describe('person drawer selected-person and recovery boundaries', () => {
  it.each([401, 403, 404, 503])('shows a generic %s failure without echoing server text', async status => {
    fetchMock.mockResolvedValueOnce(response({ error: 'database secret' }, status));
    renderBrainbase(<Drawer {...props} personId="Alex" />);
    expect(await screen.findByText('Could not load person.')).toBeTruthy();
    expect(screen.queryByText('database secret')).toBeNull(); expect(screen.queryByText('Assistant Alex')).toBeNull();
  });
  it.each([{ person: person('Other') }, { person: { ...person('Alex'), first_name: {} } }, { person: null }])('rejects an invalid selected-person response', async payload => {
    fetchMock.mockResolvedValueOnce(response(payload));
    renderBrainbase(<Drawer {...props} personId="Alex" />);
    await screen.findByText('Could not load person.'); expect(screen.queryByText('Assistant Alex')).toBeNull();
  });
  it('aborts old reads on switch and ignores a late response even when transport does not honor abort', async () => {
    let finish!: (value: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
    const view = renderBrainbase(<Drawer {...props} personId="Alex" />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const old = [...fetchMock.mock.calls];
    view.rerender(<Drawer {...props} personId="Morgan" />);
    await screen.findByText('Assistant Morgan');
    expect(old.every(call => call[1].signal.aborted && call[1].cache === 'no-store')).toBe(true);
    finish(response({ person: person('Alex') }));
    await waitFor(() => expect(screen.queryByText('Assistant Alex')).toBeNull());
    expect(screen.getByText('Assistant Morgan')).toBeTruthy();
    view.rerender(<Drawer {...props} personId={null} />);
    await waitFor(() => expect(fetchMock.mock.calls.every(call => call[1].signal.aborted)).toBe(true));
    expect(screen.queryByText('Assistant Morgan')).toBeNull();
  });
  it('aborts a pending assurance read on close and recovers by reopening the person', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('/documents')) return Promise.resolve(response({ documents: [{ id: 'doc', title: 'Policy', document_type: 'policy', lifecycle_task_id: null, created_at: '2026-10-10', current_version: { id: 'v', version_number: 1, expires_at: null, created_at: '2026-10-10' } }], capabilities: {} }));
      if (url.endsWith('/assurance')) return new Promise<Response>(() => {});
      return Promise.resolve(url.includes('/workflows') ? response({ workflows: [] }) : response({ person: person('Alex') }));
    });
    const view = renderBrainbase(<Drawer {...props} personId="Alex" />);
    await screen.findByText('Assistant Alex'); await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const pending = fetchMock.mock.calls.find(call => call[0].endsWith('/assurance'))!;
    view.rerender(<Drawer {...props} personId={null} />);
    await waitFor(() => expect(pending[1].signal.aborted).toBe(true));
    view.rerender(<Drawer {...props} personId="Alex" />);
    await screen.findByText('Assistant Alex');
  });
});
