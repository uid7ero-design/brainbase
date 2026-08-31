import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Phase B was showcase-only; Phase C (see helenaOrbitalPhaseC.test.ts)
// deliberately, narrowly wires HelenaOrbital into BrainBase.jsx only. This
// guards the containment rules that still hold after both phases: every
// OTHER HlnaOrb call site stays untouched, no new animation dependency was
// introduced, BrainGraphPanel was left alone, and no Data Hub 5A.2F file
// was coupled into the Hybrid Orbit work.
describe('Phase B/C — production/scope containment', () => {
  const root = path.resolve(__dirname, '../..');

  it('BrainBase.jsx still imports the legacy HlnaOrb as a fallback', () => {
    const source = fs.readFileSync(path.join(root, 'components/BrainBase.jsx'), 'utf-8');
    expect(source).toContain('import { HlnaOrb } from "./brand/HlnaOrb"');
  });

  it('no OTHER HlnaOrb call site was repointed at HelenaOrbital (Phase C is BrainBase.jsx-only)', () => {
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
      expect(source, `${rel} should not import HelenaOrbital`).not.toContain('HelenaOrbital');
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
    const adr = fs.readFileSync(
      path.join(root, 'docs/architecture/decisions/0001-data-hub-ingestion-foundation.md'),
      'utf-8',
    );
    expect(adr.length).toBeGreaterThan(0);
  });

  // Updated during the D.2.3 origin/main reconciliation merge: at the time
  // this branch was originally cut, lib/data-hub/storage/vercelBlobFileStore.ts
  // lived only on the separate, unmerged feat/datahub-5a2f-private-blob-adapter
  // branch, so this test asserted its absence. origin/main has since merged
  // that work in its own right (feat(data-hub): add private Vercel Blob file
  // store, and a follow-up hardening commit) — it is now first-class,
  // intentionally-pulled-in main functionality, not a scope leak from the
  // Hybrid Orbit/HelenaOrbital work this file otherwise guards. The
  // containment guarantee that actually matters — Hybrid Orbit's own scoped
  // files never reference it — is already covered by the 'Hybrid Orbit files
  // do not reference the Data Hub 5A.2F implementation' test above.
  it('the Data Hub 5A.2F storage adapter, now merged via origin/main, is untouched by Hybrid Orbit scope', () => {
    expect(fs.existsSync(path.join(root, 'lib/data-hub/storage/vercelBlobFileStore.ts'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'tests/containment/vercelBlobFileStore.test.ts'))).toBe(true);
  });
});
