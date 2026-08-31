import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Phase B — the HelenaOrbital showcase is a development-only design-QA
// route. It must be (a) excluded from the production Vercel deploy the same
// way this repo already excludes other WIP routes (app/api/ops), and (b)
// self-guarded at runtime with a NODE_ENV check as defense-in-depth. It must
// also stay disconnected from every production Helena/AI/audio surface.
describe('/dev/helena-orbital — production containment', () => {
  const root = path.resolve(__dirname, '../..');

  it('is excluded from the Vercel deploy via .vercelignore', () => {
    const vercelignore = fs.readFileSync(path.join(root, '.vercelignore'), 'utf-8');
    expect(vercelignore.split('\n').map((l) => l.trim())).toContain('app/dev');
  });

  it('the page guards itself against NODE_ENV=production', () => {
    const source = fs.readFileSync(path.join(root, 'app/dev/helena-orbital/page.tsx'), 'utf-8');
    expect(source).toMatch(/process\.env\.NODE_ENV === 'production'/);
    expect(source).toMatch(/notFound\(\)/);
    expect(source).toContain("from 'next/navigation'");
  });

  it('the showcase client component makes no production Helena/AI/audio calls', () => {
    const source = fs.readFileSync(
      path.join(root, 'app/dev/helena-orbital/HelenaOrbitalShowcase.tsx'),
      'utf-8',
    );
    for (const forbidden of [
      '/api/chat',
      '/api/hlna',
      '/api/speak',
      'SpeechRecognition',
      'getUserMedia',
      'useHelena',
      'ElevenLabs',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it('is not linked from any production navigation config', () => {
    const topNav = fs.readFileSync(path.join(root, 'components/nav/TopNav.tsx'), 'utf-8');
    const sidebar = fs.readFileSync(path.join(root, 'components/ops/Sidebar.tsx'), 'utf-8');
    expect(topNav).not.toContain('/dev/helena-orbital');
    expect(sidebar).not.toContain('/dev/helena-orbital');
  });
});
