import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { parseHelpMarkdown } from '@/lib/assurance/help/markdown';
import { resolveHelpHref, slugifyHeading } from '@/lib/assurance/help/registry';

// Assurance in-app Help rendering (jsdom): hostile document text is escaped,
// unsafe links never reach the DOM, and the Help entry points render.

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/assurance/help',
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
}));

const { HelpMarkdown } = await import('@/app/assurance/help/_components/HelpMarkdown');
const { HelpLink, PageHeader } = await import('@/app/assurance/_components/ui');
const { default: AssuranceSidebar } = await import('@/app/assurance/_components/AssuranceSidebar');

const parse = (md: string) => parseHelpMarkdown(md, h => resolveHelpHref(h, 'user-guide.md'), slugifyHeading);

describe('HelpMarkdown', () => {
  it('renders hostile text as text: no script, image or handler elements are created', () => {
    const md = [
      '## Heading <script>alert(1)</script>',
      '',
      'Para <img src=x onerror="window.__pwned=1"> and <a href="javascript:alert(1)">x</a> **bold <b>b</b>**',
      '',
      '| A | B |',
      '|---|---|',
      '| <iframe src="https://evil"></iframe> | `<svg onload=alert(1)>` |',
      '',
      '> <style>body{display:none}</style>',
      '',
      '```',
      '<script>alert(2)</script>',
      '```',
    ].join('\n');
    const { container } = renderBrainbase(<HelpMarkdown blocks={parse(md).blocks} />);
    for (const tag of ['script', 'img', 'iframe', 'svg', 'style', 'b']) {
      expect(container.querySelector(tag), tag).toBeNull();
    }
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent).toContain('<script>alert(1)</script>');
    expect(container.textContent).toContain('<img src=x onerror="window.__pwned=1">');
    // Serialised HTML only contains the escaped text (&lt;script…), and no
    // element anywhere carries an event-handler attribute.
    expect(container.innerHTML).not.toMatch(/<(script|img|iframe|svg|style)\b/i);
    expect(container.innerHTML).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    for (const el of container.querySelectorAll('*')) {
      for (const attr of el.getAttributeNames()) expect(attr, el.tagName).not.toMatch(/^on/i);
    }
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(container.querySelector('h2')?.id).toBe('heading-script-alert-1-script');
  });

  it('only allow-listed links become anchors; unsafe schemes keep just their text', () => {
    const md = '[a](javascript:alert(1)) [b](data:text/html,x) [c](file:///etc/passwd) [d](http://insecure.example) [e](//evil.example) [f](admin-guide.md#roles-and-access) [g](https://example.com/x) [h](#status)';
    const { container } = renderBrainbase(<HelpMarkdown blocks={parse(md).blocks} />);
    const links = [...container.querySelectorAll('a')];
    expect(links.map(a => a.getAttribute('href'))).toEqual(['/assurance/help/admin-guide#roles-and-access', 'https://example.com/x', '#status']);
    const ext = links[1];
    expect(ext.getAttribute('target')).toBe('_blank');
    expect(ext.getAttribute('rel')).toBe('noopener noreferrer');
    for (const a of links) expect(a.getAttribute('href')).not.toMatch(/^(javascript|data|file|vbscript):/i);
    expect(container.textContent).toContain('a b c d e f g h');
  });

  it('renders lists (with start numbers), tables and code faithfully', () => {
    const md = '11. Eleven\n12. Twelve\n\n- one\n- two\n\n| Col |\n|---|\n| **cell** |\n\n`inline`';
    const { container } = renderBrainbase(<HelpMarkdown blocks={parse(md).blocks} />);
    expect(container.querySelector('ol')?.getAttribute('start')).toBe('11');
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(container.querySelectorAll('ul > li')).toHaveLength(2);
    expect(within(container.querySelector('table')!).getByText('cell').tagName).toBe('STRONG');
    expect(container.querySelector('code')?.textContent).toBe('inline');
  });
});

describe('contextual Help entry points', () => {
  it('PageHeader help adds an accessible link to the allow-listed target', () => {
    renderBrainbase(<PageHeader title="Incidents" help="incidents" />);
    const link = screen.getByRole('link', { name: 'Help: Incidents' });
    expect(link.getAttribute('href')).toBe('/assurance/help/user-guide#incidents');
  });

  it('HelpLink for a work instruction has no anchor', () => {
    renderBrainbase(<HelpLink topic="verification" />);
    expect(screen.getByRole('link', { name: 'Help: Perform verification' }).getAttribute('href')).toBe('/assurance/help/perform-verification');
  });

  it('the sidebar keeps nine work sections plus Settings, and marks the Help footer entry current on Help pages', () => {
    renderBrainbase(<AssuranceSidebar />);
    const nav = screen.getByRole('navigation', { name: 'Assurance' });
    expect(within(nav).getAllByRole('link')).toHaveLength(10);
    expect(within(nav).getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/assurance/settings');
    const help = screen.getByRole('link', { name: 'Help & work instructions' });
    expect(help.getAttribute('href')).toBe('/assurance/help');
    expect(help.getAttribute('aria-current')).toBe('page');
  });
});
