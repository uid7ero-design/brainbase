// BrainBase Assurance — in-app Help registry.
//
// ZERO imports: pure data + pure functions, safe for server and client.
//
// The ONLY mapping from a Help slug to a Markdown file. Request input is
// never turned into a filesystem path: a slug is looked up here and, if it
// is not an exact key, the page is a 404. File paths are fixed literals
// relative to docs/assurance/ (the Help content root).
//
// Every Markdown file under docs/assurance/ must be registered here — a
// containment test fails if a document is added without an entry, or if an
// entry points at a missing file.

export type HelpGroup = 'guide' | 'work-instruction' | 'reference';

export type HelpEntry = {
  slug: string;
  /** Path relative to docs/assurance/ — a literal, never derived from input. */
  file: string;
  group: HelpGroup;
  /** Short label for lists and navigation (the page title comes from the document's H1). */
  label: string;
  /** Who the document is mainly for. Informational only — access is the Assurance capability. */
  audience?: string;
};

export const HELP_ENTRIES: readonly HelpEntry[] = [
  { slug: 'overview', file: 'README.md', group: 'guide', label: 'Overview' },
  { slug: 'user-guide', file: 'user-guide.md', group: 'guide', label: 'User guide' },
  { slug: 'admin-guide', file: 'admin-guide.md', group: 'guide', label: 'Admin guide', audience: 'Organisation admins' },
  { slug: 'report-an-incident', file: 'work-instructions/01-report-an-incident.md', group: 'work-instruction', label: '01 Report an incident' },
  { slug: 'start-an-investigation', file: 'work-instructions/02-start-an-investigation.md', group: 'work-instruction', label: '02 Start an investigation' },
  { slug: 'run-an-inspection', file: 'work-instructions/03-run-an-inspection.md', group: 'work-instruction', label: '03 Run an inspection' },
  { slug: 'create-and-run-an-audit', file: 'work-instructions/04-create-and-run-an-audit.md', group: 'work-instruction', label: '04 Create and run an audit' },
  { slug: 'raise-and-manage-a-finding', file: 'work-instructions/05-raise-and-manage-a-finding.md', group: 'work-instruction', label: '05 Raise and manage a finding' },
  { slug: 'create-and-manage-an-action', file: 'work-instructions/06-create-and-manage-an-action.md', group: 'work-instruction', label: '06 Create and manage an action' },
  { slug: 'add-and-link-evidence', file: 'work-instructions/07-add-and-link-evidence.md', group: 'work-instruction', label: '07 Add and link evidence' },
  { slug: 'perform-verification', file: 'work-instructions/08-perform-verification.md', group: 'work-instruction', label: '08 Perform verification' },
  { slug: 'close-actions-and-findings', file: 'work-instructions/09-close-actions-and-findings.md', group: 'work-instruction', label: '09 Close actions and findings' },
  { slug: 'manage-templates', file: 'work-instructions/10-manage-inspection-and-audit-templates.md', group: 'work-instruction', label: '10 Manage inspection and audit templates', audience: 'Organisation admins' },
  { slug: 'manage-risk-levels', file: 'work-instructions/11-manage-risk-levels.md', group: 'work-instruction', label: '11 Manage risk levels', audience: 'Organisation admins' },
  { slug: 'manage-reference-data', file: 'work-instructions/12-manage-reference-data.md', group: 'work-instruction', label: '12 Manage reference data', audience: 'Organisation admins' },
  { slug: 'change-log', file: 'change-log.md', group: 'reference', label: 'Change log' },
];

export const HELP_BASE_PATH = '/assurance/help';

const BY_SLUG = new Map(HELP_ENTRIES.map(e => [e.slug, e]));
const BY_FILE = new Map(HELP_ENTRIES.map(e => [e.file, e]));

/** Exact, case-sensitive allow-list lookup. Anything else is "not found". */
export function getHelpEntry(slug: unknown): HelpEntry | null {
  if (typeof slug !== 'string' || slug.length > 80) return null;
  return BY_SLUG.get(slug) ?? null;
}

export function helpHref(slug: string, anchor?: string): string {
  return `${HELP_BASE_PATH}/${slug}${anchor ? `#${anchor}` : ''}`;
}

/** Normalises "a/./b/../c" (no leading slash) — returns null if it escapes the root. */
function normaliseRelative(parts: string[]): string | null {
  const out: string[] = [];
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') { if (out.length === 0) return null; out.pop(); continue; }
    out.push(p);
  }
  return out.join('/');
}

export type ResolvedHref =
  | { kind: 'internal'; href: string }
  | { kind: 'external'; href: string };

const EXTERNAL_ALLOWED = /^https:\/\/[^\s]+$/i;
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/**
 * Resolves a link found in the Markdown document `fromFile` (a registry
 * file path). Returns null for anything that is not an explicitly
 * supported target — the renderer then shows the link text as plain text.
 *
 *   #anchor                         → same page anchor
 *   other-doc.md[#anchor]           → registered document (relative to fromFile)
 *   work-instructions/              → the Help index's work-instruction list
 *   https://…                       → external (opened safely)
 *   javascript:, data:, file:, http:, mailto:, //host, /absolute … → null
 */
export function resolveHelpHref(rawHref: string, fromFile: string): ResolvedHref | null {
  const href = rawHref.trim();
  if (!href || href.length > 500 || /[\u0000-\u001f\s<>"'`\\]/.test(href)) return null;

  if (HAS_SCHEME.test(href)) {
    return EXTERNAL_ALLOWED.test(href) ? { kind: 'external', href } : null;
  }
  if (href.startsWith('//') || href.startsWith('/')) return null;

  if (href.startsWith('#')) {
    const anchor = href.slice(1);
    return /^[a-z0-9-]{1,120}$/.test(anchor) ? { kind: 'internal', href } : null;
  }

  const [pathPart, anchorPart, ...rest] = href.split('#');
  if (rest.length > 0) return null;
  if (anchorPart !== undefined && !/^[a-z0-9-]{1,120}$/.test(anchorPart)) return null;

  const baseDir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')).split('/') : [];
  const target = normaliseRelative([...baseDir, ...pathPart.split('/')]);
  if (target === null) return null;

  if (pathPart.endsWith('/') && target === 'work-instructions') {
    return { kind: 'internal', href: `${HELP_BASE_PATH}#work-instructions` };
  }
  const entry = BY_FILE.get(target);
  if (!entry) return null;
  return { kind: 'internal', href: helpHref(entry.slug, anchorPart) };
}

/** Heading text → stable anchor id (lower-case ASCII words joined by "-"). */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'section';
}
