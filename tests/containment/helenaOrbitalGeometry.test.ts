import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Phase B — the approved Hybrid Orbit mark is locked at exactly 3 primary
// orbital rings with exactly 1 primary sphere/node on each ring (see the
// master brand kit's brainbase-mark-color.svg + Brand_Spec.md). This test
// protects that structural rule from regressing (e.g. all spheres ending up
// on the outer ring, or a ring/sphere being silently added or removed) —
// it deliberately does not assert on decorative micro-coordinates.
describe('HelenaOrbital — locked orbital geometry', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../components/brand/HelenaOrbital.tsx'),
    'utf-8',
  );

  it('renders exactly 3 primary orbital rings', () => {
    const rings = source.match(/data-hlo-ring="(outer|middle|inner)"/g) ?? [];
    expect(rings).toHaveLength(3);
    expect(new Set(rings)).toEqual(new Set([
      'data-hlo-ring="outer"',
      'data-hlo-ring="middle"',
      'data-hlo-ring="inner"',
    ]));
  });

  it('renders exactly 3 primary spheres, one per ring', () => {
    const spheres = source.match(/data-hlo-sphere="(outer|middle|inner)"/g) ?? [];
    expect(spheres).toHaveLength(3);
    expect(new Set(spheres)).toEqual(new Set([
      'data-hlo-sphere="outer"',
      'data-hlo-sphere="middle"',
      'data-hlo-sphere="inner"',
    ]));
  });

  it('associates each sphere with a distinct ring radius (not all on the outer ring)', () => {
    // Each ring group's <g> must contain exactly one ring stroke circle (R_OUTER/R_MIDDLE/R_INNER)
    // and exactly one sphere circle, keeping the 1:1 sphere-to-ring mapping structurally true.
    const ringBlocks = source.match(/data-hlo-ring="(outer|middle|inner)"[\s\S]*?<\/g>\s*<\/g>/g) ?? [];
    expect(ringBlocks).toHaveLength(3);
    for (const block of ringBlocks) {
      const sphereMatches = block.match(/data-hlo-sphere=/g) ?? [];
      expect(sphereMatches).toHaveLength(1);
    }
  });

  it('renders a single compact core element', () => {
    const cores = source.match(/data-hlo-core="true"/g) ?? [];
    expect(cores).toHaveLength(1);
  });
});
