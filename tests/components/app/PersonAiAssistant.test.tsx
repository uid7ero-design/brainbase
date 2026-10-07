import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import PersonAiAssistant from '@/app/people/_components/PersonAiAssistant';

const fetchMock = vi.fn();
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); });
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function ask(question = 'What is outstanding?') {
  fireEvent.change(screen.getByLabelText('Question'), { target: { value: question } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask HR assistant' }));
}

describe('HR-8H Person HR assistant', () => {
  it('sends only person ID and question, rendering the answer as inert text', async () => {
    fetchMock.mockResolvedValue(response({ answer: '<script>secret()</script>', metadata: 'hidden-provider-data' }));
    const { container } = renderBrainbase(<PersonAiAssistant personId="person-a" />);
    expect(fetchMock).not.toHaveBeenCalled();
    ask();
    expect(await screen.findByText('<script>secret()</script>')).toBeTruthy();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.queryByText('hidden-provider-data')).toBeNull();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/hr/ai');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ person_id: 'person-a', question: 'What is outstanding?' });
  });

  it('prevents blank questions and duplicate pending requests', async () => {
    fetchMock.mockReturnValue(new Promise(() => {}));
    renderBrainbase(<PersonAiAssistant personId="person-a" />);
    expect(screen.getByRole('button', { name: 'Ask HR assistant' })).toBeDisabled();
    ask('   ');
    expect(fetchMock).not.toHaveBeenCalled();
    ask();
    expect(screen.getByRole('button', { name: 'Asking…' })).toBeDisabled();
    fireEvent.submit(screen.getByLabelText('Question').closest('form')!);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 404, 429, 502])('shows a safe error for HTTP %s without server detail', async status => {
    fetchMock.mockResolvedValue(response({ error: 'server secret' }, status));
    renderBrainbase(<PersonAiAssistant personId="person-a" />);
    ask();
    expect(await screen.findByRole('alert')).toHaveTextContent(status === 429 ? 'Request limit reached' : 'temporarily unavailable');
    expect(screen.queryByText('server secret')).toBeNull();
    expect(screen.getByRole('button', { name: 'Ask HR assistant' })).toBeEnabled();
  });

  it.each([{}, { answer: '' }, { answer: 1 }, { answer: 'x'.repeat(6001) }])('rejects malformed answer %j', async body => {
    fetchMock.mockResolvedValue(response(body));
    renderBrainbase(<PersonAiAssistant personId="person-a" />);
    ask();
    expect(await screen.findByRole('alert')).toHaveTextContent('temporarily unavailable');
  });

  it('aborts the old person request and discards a late answer after selection changes', async () => {
    let resolve!: (value: Response) => void;
    fetchMock.mockReturnValue(new Promise<Response>(done => { resolve = done; }));
    const { rerender } = renderBrainbase(<PersonAiAssistant key="person-a" personId="person-a" />);
    ask();
    const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
    rerender(<PersonAiAssistant key="person-b" personId="person-b" />);
    expect(signal.aborted).toBe(true);
    await act(async () => { resolve(response({ answer: 'Old person answer' })); });
    expect(screen.queryByText('Old person answer')).toBeNull();
    expect(screen.getByLabelText('Question')).toHaveValue('');
  });

  it('allows retry after a network error and clears the previous error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network secret')).mockResolvedValueOnce(response({ answer: 'Safe answer' }));
    renderBrainbase(<PersonAiAssistant personId="person-a" />);
    ask();
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: 'Ask HR assistant' }));
    await waitFor(() => expect(screen.getByText('Safe answer')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
