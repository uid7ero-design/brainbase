import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TrainingEditor from '@/app/coaching/roster/[id]/plan/TrainingEditor';
import { newDrill } from '@/lib/scheduling/trainingPlan';

afterEach(cleanup);
const props = { version: 0, editable: true, minutes: 60, players: [], templates: [], save: vi.fn() };
it('uses a neutral board unless the session supplies a Tennis default', () => {
  const view = render(<TrainingEditor {...props} initial={null} />);
  expect(screen.getByLabelText('Ground layout')).toHaveValue('blank');
  view.unmount();
  render(<TrainingEditor {...props} initial={null} defaultLayout="court" />);
  expect(screen.getByLabelText('Ground layout')).toHaveValue('court');
});
it('keeps saved layouts and inherits the selected drill board without copying its markers', () => {
  const saved = { ...newDrill('half'), name: 'Passing', marks: [{ kind: 'cone' as const, x: 50, y: 50 }] };
  render(<TrainingEditor {...props} initial={[saved]} defaultLayout="court" />);
  expect(screen.getByLabelText('Ground layout')).toHaveValue('half');
  fireEvent.click(screen.getByRole('button', { name: 'Add drill' }));
  expect(screen.getByLabelText('Ground layout')).toHaveValue('half');
  expect(screen.getByRole('button', { name: 'Remove last marking' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Ground layout'), { target: { value: 'court' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add drill' }));
  expect(screen.getByLabelText('Ground layout')).toHaveValue('court');
});
it('preserves a chosen template layout instead of replacing it with the session default', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<TrainingEditor {...props} initial={null} defaultLayout="court" templates={[{ name: 'Football drills', drills: [{ ...newDrill('pitch'), name: 'Passing' }] }]} />);
  fireEvent.change(screen.getByLabelText('Saved templates'), { target: { value: 'Football drills' } });
  fireEvent.click(screen.getByRole('button', { name: 'Use template' }));
  expect(screen.getByLabelText('Ground layout')).toHaveValue('pitch');
  confirm.mockRestore();
});
