import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TrainingEditor from '@/app/coaching/roster/[id]/plan/TrainingEditor';
import { newDrill, type Drill } from '@/lib/scheduling/trainingPlan';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const passing: Drill = { ...newDrill('half'), name: 'Passing', minutes: 15, notes: 'Return to centre', marks: [{ kind: 'arrow', x: 10, y: 20, end: { x: 80, y: 20 } }, { kind: 'player', player: 'private-id', x: 50, y: 50 }] };
const props = { version: 2, editable: true, minutes: 60, players: [{ id: 'private-id', name: 'Private athlete', status: 'confirmed', attendance: null }], templates: [], save: vi.fn(), session: { name: 'Junior skills', schedule: 'Club training', day: '2026-11-20', time: '09:00', venue: 'Court 1' } };

it('duplicates independently and reorders without saving or changing the original', () => {
  const original = structuredClone(passing);
  const save = vi.fn();
  render(<TrainingEditor {...props} save={save} initial={[passing, { ...newDrill('court'), name: 'Volley' }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Duplicate drill' }));
  expect(screen.getByLabelText('Drill name')).toHaveValue('Passing (copy)');
  expect(screen.getByLabelText('Ground layout')).toHaveValue('half');
  expect(screen.getByRole('list', { name: 'Board players' })).toHaveTextContent('Private athlete');
  fireEvent.click(screen.getByRole('button', { name: 'Remove last marking' }));
  fireEvent.change(screen.getByLabelText('Coaching notes'), { target: { value: 'New progression' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move later' }));
  expect(screen.getByRole('button', { name: 'Move later' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Move earlier' }));
  fireEvent.click(screen.getByRole('button', { name: '1. Passing 15 min' }));
  expect(screen.getByLabelText('Coaching notes')).toHaveValue('Return to centre');
  expect(screen.getByRole('list', { name: 'Board players' })).toHaveTextContent('Private athlete');
  expect(passing).toEqual(original);
  expect(screen.getByText('Unsaved draft')).toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

it('shows all boards and cumulative timings with no roster identities, and prints only on request', () => {
  const print = vi.spyOn(window, 'print').mockImplementation(() => {});
  const save = vi.fn();
  render(<TrainingEditor {...props} save={save} initial={[passing, { ...newDrill('court'), name: 'Volley', minutes: 50 }]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Session sheet' }));
  const sheet = screen.getByRole('dialog', { name: 'Junior skills session sheet' });
  expect(sheet).toHaveTextContent('Club training · 2026-11-20 · 09:00 · Court 1');
  expect(sheet).toHaveTextContent('Saved plan · version 2');
  expect(sheet).toHaveTextContent('0–15 min');
  expect(sheet).toHaveTextContent('15–65 min');
  expect(sheet).toHaveTextContent('5 min over time');
  expect(within(sheet).getAllByRole('img')).toHaveLength(2);
  expect(sheet).not.toHaveTextContent('Private athlete');
  expect(sheet.innerHTML).not.toContain('private-id');
  expect(within(sheet).queryByRole('list', { name: 'Board players' })).not.toBeInTheDocument();
  expect(print).not.toHaveBeenCalled();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Print session sheet' }));
  expect(print).toHaveBeenCalledOnce();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
});

it('does not invent timing when a duration is invalid and keeps the draft label', () => {
  render(<TrainingEditor {...props} initial={[passing, newDrill()]} />);
  fireEvent.change(screen.getByLabelText('Minutes'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Session sheet' }));
  const sheet = screen.getByRole('dialog');
  expect(sheet).toHaveTextContent('Unsaved draft');
  expect(sheet).toHaveTextContent('Timing incomplete — review drill durations.');
  expect(sheet).not.toHaveTextContent('0–10 min');
});

it('blocks draft edits and printing after an uncertain save but keeps the sheet available to review', async () => {
  const save = vi.fn().mockRejectedValue(new Error('lost'));
  render(<TrainingEditor {...props} save={save} initial={[passing]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await screen.findByRole('button', { name: 'Reload saved plan' });
  expect(screen.getByRole('button', { name: 'Duplicate drill' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Move later' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Session sheet' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Unconfirmed draft');
  expect(screen.getByRole('button', { name: 'Print session sheet' })).toBeDisabled();
  expect(save).toHaveBeenCalledOnce();
});

it('respects the drill limit and exposes sheets without edit controls for historical plans', () => {
  const view = render(<TrainingEditor {...props} initial={Array.from({ length: 30 }, () => structuredClone(passing))} />);
  expect(screen.getByRole('button', { name: 'Duplicate drill' })).toBeDisabled();
  view.unmount();
  render(<TrainingEditor {...props} editable={false} initial={[passing]} />);
  expect(screen.queryByRole('button', { name: 'Duplicate drill' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Session sheet' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Saved plan · version 2');
});
