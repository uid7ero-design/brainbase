export const layouts = {
  pitch: 'Football pitch',
  half: 'Football half-pitch',
  court: 'Tennis court',
  blank: 'Blank space',
};
export type Layout = keyof typeof layouts;
export type Point = { x: number; y: number };
export type Mark = Point &
  (
    | { kind: 'cone' | 'ball' | 'position' }
    | { kind: 'player'; player: string }
    | { kind: 'arrow'; end: Point }
  );
export type Drill = { name: string; minutes: number; notes: string; layout: Layout; marks: Mark[] };
export type Player = { id: string; name: string; attendance: string | null; status: string };
export const newDrill = (): Drill => ({ name: '', minutes: 10, notes: '', layout: 'pitch', marks: [] });

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function coordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 100;
}
function point(value: unknown): Point {
  if (!object(value) || !coordinate(value.x) || !coordinate(value.y)) throw Error('Invalid board position.');
  return { x: value.x, y: value.y };
}
// Rebuild the payload so only recognised fields can be stored or copied into a template.
export function decodePlan(input: unknown, roster: Set<string>): Drill[] {
  if (!Array.isArray(input) || !input.length || input.length > 30) throw Error('Use 1 to 30 drills.');
  return input.map((d) => {
    if (
      !object(d) ||
      typeof d.name !== 'string' ||
      !d.name.trim() ||
      d.name.length > 100 ||
      typeof d.minutes !== 'number' ||
      !Number.isInteger(d.minutes) ||
      d.minutes < 1 ||
      d.minutes > 240 ||
      typeof d.notes !== 'string' ||
      d.notes.length > 1500 ||
      typeof d.layout !== 'string' ||
      !Object.hasOwn(layouts, d.layout) ||
      !Array.isArray(d.marks) ||
      d.marks.length > 80
    )
      throw Error('Each drill needs a name, 1 to 240 minutes and a valid board.');
    const placed = new Set<string>();
    const marks: Mark[] = d.marks.map((m: unknown) => {
      const p = point(m);
      if (!object(m)) throw Error('Invalid marker.');
      if (m.kind === 'cone' || m.kind === 'ball' || m.kind === 'position') return { ...p, kind: m.kind };
      if (m.kind === 'arrow') return { ...p, kind: 'arrow', end: point(m.end) };
      if (
        m.kind === 'player' &&
        typeof m.player === 'string' &&
        roster.has(m.player) &&
        !placed.has(m.player)
      ) {
        placed.add(m.player);
        return { ...p, kind: 'player', player: m.player };
      }
      throw Error('Review the players on this board against the current roster.');
    });
    return {
      name: d.name.trim(),
      minutes: d.minutes,
      notes: d.notes.trim(),
      layout: d.layout as Layout,
      marks,
    };
  });
}
export function templateDrills(drills: Drill[]): Drill[] {
  return drills.map((d) => ({
    ...d,
    marks: d.marks.map((m) => (m.kind === 'player' ? { kind: 'position', x: m.x, y: m.y } : m)),
  }));
}
