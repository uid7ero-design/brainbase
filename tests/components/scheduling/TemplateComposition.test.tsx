import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import TrainingEditor from '@/app/coaching/roster/[id]/plan/TrainingEditor';
import { newDrill } from '@/lib/scheduling/trainingPlan';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const warmup = { ...newDrill('court'), name: 'Warmup', notes: 'Keep this draft' };
const template = { name: 'Rally progression', drills: [{ ...newDrill('court'), name: 'Deep rally', minutes: 15, notes: 'Recover to centre', marks: [{ kind: 'player' as const, player: 'old-player', x: 20, y: 40 }] }] };
const props = { initial: [warmup], version: 1, editable: true, minutes: 45, players: [], templates: [template], save: vi.fn() };
function choose() { fireEvent.change(screen.getByLabelText('Saved templates'), { target: { value: template.name } }); }

it('previews notes, timing and anonymised boards without changing or saving the draft', () => {
  render(<TrainingEditor {...props} />);
  choose();
  fireEvent.click(screen.getByRole('button', { name: 'Preview template' }));
  const preview = screen.getByRole('dialog', { name: 'Rally progression template preview' });
  expect(preview).toHaveTextContent('your plan is unchanged');
  expect(preview).toHaveTextContent('0–15 min');
  expect(preview).toHaveTextContent('Recover to centre');
  expect(preview.innerHTML).not.toContain('old-player');
  expect(within(preview).queryByRole('button', { name: /Print/ })).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.getByLabelText('Drill name')).toHaveValue('Warmup');
  expect(screen.getByText('Saved plan · version 1')).toBeInTheDocument();
  expect(props.save).not.toHaveBeenCalled();
});

it('appends independent anonymous copies and preserves existing drills until explicit save', async () => {
  const save = vi.fn().mockResolvedValue({ version: 2 });
  const before = structuredClone(template);
  render(<TrainingEditor {...props} save={save} />);
  choose();
  fireEvent.click(screen.getByRole('button', { name: 'Add drills to plan' }));
  expect(screen.getByLabelText('Drill name')).toHaveValue('Deep rally');
  fireEvent.change(screen.getByLabelText('Coaching notes'), { target: { value: 'Adjusted for this group' } });
  fireEvent.click(screen.getByRole('button', { name: '1. Warmup 10 min' }));
  expect(screen.getByLabelText('Coaching notes')).toHaveValue('Keep this draft');
  expect(save).not.toHaveBeenCalled();
  expect(template).toEqual(before);
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await screen.findByText('Saved plan · version 2');
  const saved = save.mock.calls[0][1];
  expect(saved.map((d: {name: string}) => d.name)).toEqual(['Warmup', 'Deep rally']);
  expect(JSON.stringify(saved)).not.toContain('old-player');
});

it('explains the 30-drill limit, still previews, and preserves cancelled replacement', () => {
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<TrainingEditor {...props} initial={Array.from({length:30}, () => structuredClone(warmup))} />);
  choose();
  expect(screen.getByRole('button', { name: 'Add drills to plan' })).toBeDisabled();
  expect(screen.getByText(/would exceed 30 drills/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Preview template' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Replace drills with template' }));
  expect(confirm).toHaveBeenCalledOnce();
  expect(screen.getByLabelText('Drill name')).toHaveValue('Warmup');
  expect(screen.getByText('Saved plan · version 1')).toBeInTheDocument();
});

it('allows exactly 30 drills and confirms replacing them with an independent template copy', () => {
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<TrainingEditor {...props} initial={Array.from({length:29}, () => structuredClone(warmup))} />);
  choose();
  fireEvent.click(screen.getByRole('button', {name:'Add drills to plan'}));
  expect(screen.getByRole('button', {name:'30. Deep rally 15 min'})).toBeInTheDocument();
  expect(screen.getByRole('button', {name:'Add drills to plan'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button', {name:'Replace drills with template'}));
  expect(screen.getByRole('button', {name:'1. Deep rally 15 min'})).toBeInTheDocument();
  expect(screen.queryByRole('button', {name:'1. Warmup 10 min'})).not.toBeInTheDocument();
  expect(props.save).not.toHaveBeenCalled();
});

it('blocks template changes after an uncertain save and hides them in historical plans', async () => {
  const view = render(<TrainingEditor {...props} save={vi.fn().mockRejectedValue(new Error('lost'))} />);
  choose();
  fireEvent.click(screen.getByRole('button', { name: 'Save plan' }));
  await screen.findByRole('button', { name: 'Reload saved plan' });
  for (const name of ['Preview template', 'Add drills to plan', 'Replace drills with template']) expect(screen.getByRole('button', {name})).toBeDisabled();
  view.unmount();
  render(<TrainingEditor {...props} editable={false} />);
  expect(screen.queryByLabelText('Saved templates')).not.toBeInTheDocument();
});
