import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const design = fs.readFileSync(
  path.resolve(process.cwd(), 'docs/architecture/c7-9-finance-close-reconciliation-design.md'),
  'utf8',
);
const matrix = fs.readFileSync(
  path.resolve(process.cwd(), 'docs/architecture/c7-9-verification-matrix.md'),
  'utf8',
);

describe('C7.9 verification matrix', () => {
  it('maps all 35 required architecture tests to executable evidence', () => {
    const requiredSection = design
      .split('## 27. Required tests')[1]
      ?.split('## 28. Non-goals')[0] ?? '';
    const required = [...requiredSection.matchAll(/^([1-9]|[12][0-9]|3[0-5])\. /gm)]
      .map(match => Number(match[1]));
    expect(required).toEqual(Array.from({ length: 35 }, (_, index) => index + 1));

    const mapped = [...matrix.matchAll(/^\| ([1-9]|[12][0-9]|3[0-5]) \|/gm)]
      .map(match => Number(match[1]));
    expect(mapped).toEqual(Array.from({ length: 35 }, (_, index) => index + 1));
  });

  it('keeps the matrix linked from the governing architecture', () => {
    expect(design).toContain('docs/architecture/c7-9-verification-matrix.md');
  });

  it('keeps the two remaining choices explicit as deferred policy rather than inferred behavior', () => {
    expect(matrix).toContain(
      'Whether every financial-year close must require an External GL reconciliation',
    );
    expect(matrix).toContain(
      'Whether reconciliation may ever use a non-zero tolerance.',
    );
    expect(matrix).toContain('remains exact at zero-cent tolerance.');
    expect(design).toContain('Two policy choices remain deliberately deferred rather than inferred');
  });
});
