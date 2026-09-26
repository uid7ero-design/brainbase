import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('HLNA Labs broken-orbit alignment', () => {
  const mark = read('components/brand/BrokenOrbitMark.tsx');
  const lockup = read('components/public/BrainbaseLockup.tsx');
  const globals = read('app/globals.css');
  const publicTokens = read('styles/brainbase-tokens.css');

  it('locks the approved geometry exactly', () => {
    expect(mark).toContain('viewBox="0 0 100 100"');
    expect(mark).toContain('M88.64 43.79 A40 24 0 1 1 60.35 26.82');
    expect(mark).toContain('rotate(-30 50 50)');
    expect(mark).toContain('strokeWidth="4.5"');
    expect(mark).toContain('cx="78.28" cy="33.03" r="6"');
    expect(mark).toContain('cx="50" cy="50" r="12"');
  });

  it('uses only the approved BrainBase core accents and neutral orbit line', () => {
    expect(globals).toContain('--brand-line: #F3EEE6;');
    expect(globals).toContain('--brand-brainbase-accent: #9B7BFF;');
    expect(globals).toContain('--brand-line: #15171B;');
    expect(globals).toContain('--brand-brainbase-accent: #6D4CD6;');
    expect(publicTokens).toContain('--brand-brainbase-accent: #9b7bff;');
    expect(publicTokens).toContain('--brand-brainbase-accent: #6d4cd6;');
  });

  it('keeps the BrainBase lockup distinct from the parent studio accent', () => {
    expect(lockup).toContain('context="brainbase"');
    expect(lockup).toContain('BRΛINBΛSE');
    expect(lockup).not.toContain('context="hlna"');
  });

  it('contains no glow, gradient, or shadow in the approved mark component', () => {
    expect(mark).not.toMatch(/gradient|filter|shadow|blur/i);
  });
});
