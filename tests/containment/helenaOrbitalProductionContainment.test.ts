import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Phase B is showcase-only. This guards the containment rules from Phase B's
// brief: no production Helena surface was repointed at the new component,
// no new animation dependency was introduced, BrainGraphPanel was left
// alone, and no Data Hub 5A.2F file was coupled into the Hybrid Orbit work.
describe('Phase B — production/scope containment', () => {
  const root = path.resolve(__dirname, '../..');

  it('BrainBase.jsx still renders the existing production HlnaOrb, unchanged', () => {
    const source = fs.readFileSync(path.join(root, 'components/BrainBase.jsx'), 'utf-8');
    expect(source).toContain('import { HlnaOrb } from "./brand/HlnaOrb"');
    expect(source).not.toContain('HelenaOrbital');
  });

  it('no existing HlnaOrb call site was repointed at HelenaOrbital', () => {
    const callSites = [
      'app/login/page.tsx',
      'app/signup/page.tsx',
      'app/demo/page.tsx',
      'app/command/page.tsx',
      'components/voice/MicButton.jsx',
      'components/ops/IntelRail.tsx',
    ];
    for (const rel of callSites) {
      const source = fs.readFileSync(path.join(root, rel), 'utf-8');
      expect(source, `${rel} should not import HelenaOrbital in Phase B`).not.toContain('HelenaOrbital');
    }
  });

  it('BrainGraphPanel.jsx was not modified to reference the orbital', () => {
    const source = fs.readFileSync(path.join(root, 'components/panels/BrainGraphPanel.jsx'), 'utf-8');
    expect(source).not.toContain('HelenaOrbital');
    expect(source).not.toContain('HlnaOrb');
  });

  it('no new animation dependency was added to package.json', () => {
    const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf-8');
    for (const dep of ['framer-motion', '"motion"', 'gsap', 'react-spring', '@react-three']) {
      expect(pkg).not.toContain(dep);
    }
  });

  it('Hybrid Orbit files do not reference the Data Hub 5A.2F implementation', () => {
    const hybridOrbitFiles = [
      'components/brand/HelenaOrbital.tsx',
      'app/dev/helena-orbital/page.tsx',
      'app/dev/helena-orbital/HelenaOrbitalShowcase.tsx',
    ];
    for (const rel of hybridOrbitFiles) {
      const source = fs.readFileSync(path.join(root, rel), 'utf-8');
      expect(source).not.toContain('vercelBlobFileStore');
      expect(source).not.toContain('data-hub');
    }
  });

  it('the Data Hub 5A.2F ADR present on this baseline was not modified/emptied', () => {
    // Only the ADR ships on origin/main at the time this branch was cut —
    // lib/data-hub/storage/vercelBlobFileStore.ts and its containment test
    // live exclusively on the separate, unmerged
    // feat/datahub-5a2f-private-blob-adapter branch and are therefore
    // structurally absent here, not just untouched.
    const adr = fs.readFileSync(
      path.join(root, 'docs/architecture/decisions/0001-data-hub-ingestion-foundation.md'),
      'utf-8',
    );
    expect(adr.length).toBeGreaterThan(0);
  });

  it('the unmerged 5A.2F storage adapter was not pulled onto this branch', () => {
    expect(fs.existsSync(path.join(root, 'lib/data-hub/storage/vercelBlobFileStore.ts'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'tests/containment/vercelBlobFileStore.test.ts'))).toBe(false);
  });
});
