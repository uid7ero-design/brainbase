import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TrainingEditor from '@/app/coaching/roster/[id]/plan/TrainingEditor';
import { newDrill } from '@/lib/scheduling/trainingPlan';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function open(
  save: (
    version: number,
    drills: ReturnType<typeof newDrill>[],
    template: string,
  ) => Promise<{ version?: number; error?: string; recovery?: boolean }>,
) {
  return render(
    <TrainingEditor
      initial={[{ ...newDrill(), name: 'Passing' }]}
      version={1}
      editable
      minutes={60}
      players={[]}
      templates={[]}
      save={save}
    />,
  );
}
it('preserves the draft and blocks replay after a lost save response, including after switching views', async () => {
  const save = vi.fn().mockRejectedValue(new Error('response lost'));
  open(save);
  fireEvent.click(screen.getByRole('button', { name: 'Add drill' }));
  fireEvent.change(screen.getByLabelText('Drill name'), {
    target: { value: 'Volley recovery' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await screen.findByRole('button', { name: 'Reload saved plan' });
  expect(screen.getByLabelText('Drill name')).toHaveValue('Volley recovery');
  expect(screen.getByLabelText('Drill name')).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  fireEvent.click(screen.getByRole('button', { name: 'Run session' }));
  expect(screen.getByText(/running your unsaved draft/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Previous drill' }));
  expect(screen.getByRole('heading', { name: /Passing/ })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next drill' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit drills' }));
  expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved plan' }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(save).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Drill name')).toHaveValue('Volley recovery');
});
it('also locks saving for a server recovery receipt', async () => {
  open(vi.fn().mockResolvedValue({ error: 'The session changed.', recovery: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await screen.findByRole('button', { name: 'Reload saved plan' });
  expect(screen.getByRole('button', { name: 'Save plan' })).toBeDisabled();
});
it('does not queue a second save while the first is pending', async () => {
  let finish!: (receipt: { version: number }) => void;
  const save = vi.fn(() => new Promise<{ version: number }>((resolve) => { finish = resolve; }));
  open(save);
  const button = screen.getByRole('button', { name: 'Save plan' });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(button).toBeDisabled();
  expect(save).toHaveBeenCalledOnce();
  finish({ version: 2 });
  await screen.findByText('Saved plan · version 2');
  expect(button).toBeEnabled();
});
it('allows correction of a known validation failure and clears dirty template state after success', async () => {
  const save = vi
    .fn()
    .mockResolvedValueOnce({ error: 'Name already used.' })
    .mockResolvedValueOnce({ version: 2 });
  open(save);
  fireEvent.change(screen.getByLabelText(/Save as a reusable template/), {
    target: { value: 'Club warmup' },
  });
  expect(screen.getByText('Unsaved draft')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await screen.findByText('Name already used.');
  expect(screen.queryByRole('button', { name: 'Reload saved plan' })).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText(/Save as a reusable template/), {
    target: { value: 'New warmup' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await waitFor(() => expect(screen.getByText('Saved plan · version 2')).toBeInTheDocument());
  expect(screen.getByLabelText(/Save as a reusable template/)).toHaveValue('');
});
