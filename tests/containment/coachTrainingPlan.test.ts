import { expect, it } from 'vitest';
import { decodePlan, newDrill, templateDrills } from '@/lib/scheduling/trainingPlan';
const drill = {
  ...newDrill(),
  name: 'Passing',
  marks: [{ x: 50, y: 50, kind: 'player' as const, player: 'member' }],
};
it('keeps positions reusable without copying player references or unexpected payload fields', () => {
  const saved = decodePlan([{ ...drill, hidden: 123 }], new Set(['member']));
  expect(saved[0]).not.toHaveProperty('hidden');
  expect(templateDrills(saved)[0].marks).toEqual([{ x: 50, y: 50, kind: 'position' }]);
  expect(saved[0].marks).toEqual(drill.marks);
});
it('rejects unrelated roster identities, duplicate placements and invalid board coordinates', () => {
  expect(() => decodePlan([drill], new Set())).toThrow();
  for (const marks of [
    [...drill.marks, ...drill.marks],
    [{ kind: 'cone', x: -1, y: 0 }],
    [{ kind: 'arrow', x: 0, y: 0, end: { x: 101, y: 0 } }],
  ]) {
    expect(() => decodePlan([{ ...drill, marks }], new Set(['member']))).toThrow();
  }
});
it('bounds drill count and duration and rejects unknown layouts', () => {
  for (const input of [
    [],
    Array(31).fill(drill),
    [{ ...drill, minutes: 0 }],
    [{ ...drill, layout: 'constructor' }],
  ]) {
    expect(() => decodePlan(input, new Set(['member']))).toThrow();
  }
});
