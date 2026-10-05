import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Authenticated visual-completion pass (P5) — the tennis tenant's own
// signed-in surfaces (slug-gated tennis dashboard + its panels, Leads, Squad
// contacts, Sessions calendar, Blog, Requests pipeline). They were
// dark-only islands: an injected #08090c page slab, white-alpha text,
// colorScheme:'dark' inputs, blurred/glowing chrome, violet literals and
// dark-only Tailwind (text-white / text-zinc-* / bg-white/N) — unreadable
// in light. Source-text guard, comments stripped first. Colour now comes
// from tokens; sport/data encodings come from lib/sessionDisplay at runtime.

const ROOT = path.resolve(__dirname, '../..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf-8');
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1').replace(/\{\s*\}/g, '{}');

const TSX = [
  'components/dashboard/TennisDashboard.tsx',
  'components/dashboard/WeatherPanel.tsx',
  'components/dashboard/LeadsChart.tsx',
  'components/dashboard/TodaysSchedule.tsx',
  'components/dashboard/TennisNewsPanel.tsx',
  'components/dashboard/HlnaInsightCard.tsx',
  'app/dashboard/sessions/page.tsx',
  'app/dashboard/blog/page.tsx',
  'app/dashboard/pipeline/page.tsx',
  'app/dashboard/leads/page.tsx',
  'app/dashboard/leads/[id]/page.tsx',
  'app/dashboard/leads/[id]/ConvertToSquadButton.tsx',
  'app/dashboard/leads/[id]/DeleteLeadButton.tsx',
  'app/dashboard/leads/[id]/LeadMessaging.tsx',
  'app/dashboard/leads/[id]/LeadStatusPicker.tsx',
  'app/dashboard/contacts/page.tsx',
  'app/dashboard/contacts/ContactsClient.tsx',
  'app/dashboard/contacts/[id]/page.tsx',
  'app/dashboard/contacts/[id]/ContactDetailClient.tsx',
  'app/dashboard/contacts/[id]/JournalClient.tsx',
];
const CSS = [
  'components/dashboard/TennisDashboard.module.css',
  'components/dashboard/WeatherPanel.module.css',
  'components/dashboard/LeadsChart.module.css',
  'components/dashboard/TodaysSchedule.module.css',
  'components/dashboard/TennisNewsPanel.module.css',
  'components/dashboard/HlnaInsightCard.module.css',
  'app/dashboard/blog/Blog.module.css',
  'app/dashboard/leads/Leads.module.css',
  'app/dashboard/contacts/Contacts.module.css',
];

// The ONE kept literal: the session-type swatch fallback fill in Sessions'
// ManageSessionTypesModal (a data swatch, not text). Removed narrowly.
const ALLOWED: Record<string, string[]> = {
  'app/dashboard/sessions/page.tsx': ["SESSION_TYPE_COLOUR_PALETTE[t.colour_key]?.text ?? '#94a3b8'"],
};

function source(file: string) {
  let src = stripComments(read(file));
  for (const lit of ALLOWED[file] ?? []) src = src.split(lit).join('');
  return src;
}

const WHITE_ALPHA = /rgba\(\s*255\s*,\s*255\s*,\s*255\s*,/;
const ANY_HEX = /#[0-9a-fA-F]{3,8}\b/;
const ANY_RGBA = /rgba?\(\s*\d/;
const OLD_VIOLET =
  /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|A5B4FC|818CF8|6366F1|C7D2FE)\b|rgba\(\s*(139\s*,\s*92\s*,\s*246|167\s*,\s*139\s*,\s*250|124\s*,\s*58\s*,\s*237|99\s*,\s*102\s*,\s*241)\b/i;
const FORCED_DARK = /colorScheme:\s*['"]dark|color-scheme:\s*dark/;
const OUTLINE_NONE = /outline:\s*['"]?(none|0)\b/;
const BLUR = /backdropFilter|backdrop-filter|blur\(/;
const GRADIENT = /(linear|radial|conic)-gradient/;
const GLOW = /(boxShadow|box-shadow|textShadow|text-shadow|filter):\s*['"`]?[^;'"`]*\b0 0 \d/;
const LEGACY_FONT = /var\(--font-inter\)|-apple-system|BlinkMacSystemFont|'Segoe UI'/;
const DARK_TAILWIND = /\b(text-white|text-zinc-\d+|text-gray-\d+|bg-white\/\d+|border-white\/\d+|bg-black|ring-offset-black|bg-green-500|text-green-400|text-red-400|bg-zinc-\d+)\b/;

describe('tennis tenant surfaces read in light and dark', () => {
  for (const file of [...TSX, ...CSS]) {
    describe(file, () => {
      const src = source(file);

      it('has no white-alpha neutrals and no hard-coded hex/rgb colour (tokens only; data hues come from lib/sessionDisplay)', () => {
        expect(src).not.toMatch(WHITE_ALPHA);
        expect(src).not.toMatch(ANY_HEX);
        expect(src).not.toMatch(ANY_RGBA);
      });

      it('has no old violet/indigo chrome, forced dark scheme or outline suppression', () => {
        expect(src).not.toMatch(OLD_VIOLET);
        expect(src).not.toMatch(FORCED_DARK);
        expect(src).not.toMatch(OUTLINE_NONE);
      });

      it('has no blur, decorative gradients or glows', () => {
        expect(src).not.toMatch(BLUR);
        expect(src).not.toMatch(GRADIENT);
        expect(src).not.toMatch(GLOW);
      });

      it('uses no legacy font stack or dark-only Tailwind palette', () => {
        expect(src).not.toMatch(LEGACY_FONT);
        expect(src).not.toMatch(DARK_TAILWIND);
      });
    });
  }

  it('the allow-list is still needed (fails if the kept literal disappears, so the list cannot rot)', () => {
    for (const [file, lits] of Object.entries(ALLOWED)) {
      for (const lit of lits) expect(read(file)).toContain(lit);
    }
  });
});

describe('tennis tenant structure', () => {
  const dash = stripComments(read('components/dashboard/TennisDashboard.tsx'));

  it('TennisDashboard follows the theme: no injected #08090c page slab, page painted from --bg-base', () => {
    expect(dash).not.toContain('#08090c');
    expect(dash).not.toMatch(/<style[\s>]/);
    expect(read('components/dashboard/TennisDashboard.module.css')).toMatch(/background:\s*var\(--bg-base\)/);
  });

  it('the HLNΛ header uses the approved BrokenOrbitMark, not the animated HlnaOrb as a logo', () => {
    expect(dash).toContain('<BrokenOrbitMark');
    expect(dash).not.toMatch(/<HlnaOrb\b/);
  });

  it('lead and contact statuses use the shared semantic states', () => {
    const leadStatus = read('app/dashboard/leads/leadStatus.ts');
    expect(leadStatus).toMatch(/cancelled:\s+'error'/);
    expect(leadStatus).toMatch(/booked:\s+'success'/);
    expect(read('app/dashboard/leads/page.tsx')).toContain('<Badge state={leadStatusState(lead.status)}');
    expect(read('app/dashboard/contacts/ContactsClient.tsx')).toMatch(/inactive:\s+'inactive'/);
  });

  it('forms use labelled Field controls and the contact drawer is the shared SlidePanel dialog', () => {
    const contacts = read('app/dashboard/contacts/ContactsClient.tsx');
    expect(contacts).toContain("<SlidePanel open onClose={onClose} title={mode === 'create' ? 'New Contact' : 'Edit Contact'}>");
    expect(contacts).toContain('fieldControlClassName');
    expect(contacts).not.toMatch(/function F\(/);
    expect(read('app/dashboard/leads/[id]/LeadMessaging.tsx')).toContain('<Field label="Subject">');
    expect(read('app/dashboard/leads/[id]/LeadStatusPicker.tsx')).toContain('aria-pressed={status === s.value}');
  });

  it('sessions calendar entries are keyboard-operable toggle buttons and inputs are not forced dark', () => {
    const sessions = read('app/dashboard/sessions/page.tsx');
    expect(sessions).toContain('aria-pressed={!!selected} onClick={onSelect}');
    expect(sessions).not.toMatch(FORCED_DARK);
  });
});
