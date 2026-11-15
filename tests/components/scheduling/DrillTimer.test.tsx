import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DrillTimer from '@/app/coaching/roster/[id]/plan/DrillTimer';
import TrainingEditor from '@/app/coaching/roster/[id]/plan/TrainingEditor';
import { newDrill } from '@/lib/scheduling/trainingPlan';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

it('keeps the remaining fraction of a second through pause and resume, and stops at zero', () => {
  vi.useFakeTimers();
  render(<DrillTimer minutes={1} />);
  click('Start timer');
  advance(15250);
  click('Pause timer');
  advance(90000);
  expect(screen.getByRole('timer')).toHaveTextContent('0:45');
  click('Resume timer');
  advance(44750);
  expect(screen.getByRole('timer')).toHaveTextContent('0:00');
  expect(screen.getByRole('status')).toHaveTextContent('Time is up');
  expect(vi.getTimerCount()).toBe(0);
  click('Reset timer');
  expect(screen.getByRole('timer')).toHaveTextContent('1:00');
});

it('catches up after background throttling and clears the active timer on reset or unmount', () => {
  vi.useFakeTimers();
  const view = render(<DrillTimer minutes={2} />);
  click('Start timer');
  vi.setSystemTime(Date.now() + 83000);
  fireEvent(document, new Event('visibilitychange'));
  expect(screen.getByRole('timer')).toHaveTextContent('0:37');
  click('Reset timer');
  advance(5000);
  expect(screen.getByRole('timer')).toHaveTextContent('2:00');
  click('Start timer');
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([0, -1, 1.5, 241])('blocks timing an invalid draft duration of %s minutes', minutes => {
  render(<DrillTimer minutes={minutes} />);
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByText(/1 to 240 minutes/)).toBeVisible();
});

it('limits timing to active run mode and resets when the coach returns to editing', async () => {
  const save = vi.fn().mockRejectedValue(new Error('lost response'));
  const props = { initial: [newDrill()], version: 1, minutes: 45, templates: [], players: [], save };
  const view = render(<TrainingEditor {...props} editable />);
  expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  click('Run session');
  click('Start timer');
  click('Edit drills');
  click('Run session');
  expect(screen.getByRole('button', {name:'Start timer'})).toBeVisible();
  expect(save).not.toHaveBeenCalled();
  click('Edit drills');
  click('Save plan');
  await screen.findByRole('button', {name:'Reload saved plan'});
  click('Run session');
  expect(screen.queryByRole('timer')).not.toBeInTheDocument();
  view.unmount();
  render(<TrainingEditor {...props} editable={false} />);
  expect(screen.queryByRole('timer')).not.toBeInTheDocument();
});
