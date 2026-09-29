import 'server-only';
import fs from 'fs';
import path from 'path';
import { HELP_ENTRIES, getHelpEntry, resolveHelpHref, slugifyHeading, type HelpEntry } from './registry';
import { inlineText, parseHelpMarkdown, type ParsedHelpDoc } from './markdown';
import { buildHelpSections, searchHelp, type HelpSearchResult, type HelpSection } from './search';

// BrainBase Assurance — Help content loader (server only).
//
// Files are read ONLY from the fixed Help content root (docs/assurance/),
// using the literal file path from the registry entry. The request supplies
// a slug; getHelpEntry() is an exact allow-list lookup, so no request value
// ever reaches the filesystem. As defence in depth, the resolved path must
// still sit inside the content root.
//
// The deployment includes these files through outputFileTracingIncludes
// for the /assurance/help routes (next.config.ts).

const HELP_ROOT = path.join(process.cwd(), 'docs', 'assurance');

export type LoadedHelpDoc = { entry: HelpEntry; doc: ParsedHelpDoc };

const cache = new Map<string, LoadedHelpDoc>();

function readEntry(entry: HelpEntry): LoadedHelpDoc | null {
  const cached = process.env.NODE_ENV === 'production' ? cache.get(entry.slug) : undefined;
  if (cached) return cached;
  const full = path.resolve(HELP_ROOT, entry.file);
  if (!full.startsWith(HELP_ROOT + path.sep) || path.extname(full) !== '.md') return null;
  let source: string;
  try {
    source = fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
  const doc = parseHelpMarkdown(source, href => resolveHelpHref(href, entry.file), slugifyHeading);
  const loaded = { entry, doc };
  cache.set(entry.slug, loaded);
  return loaded;
}

/** The allow-listed document for `slug`, or null (unknown slug or missing file). */
export function loadHelpDoc(slug: unknown): LoadedHelpDoc | null {
  const entry = getHelpEntry(slug);
  return entry ? readEntry(entry) : null;
}

/** Every registered document that could be read (for the index and search). */
export function loadAllHelpDocs(): LoadedHelpDoc[] {
  return HELP_ENTRIES.map(readEntry).filter((d): d is LoadedHelpDoc => d !== null);
}

let sectionCache: HelpSection[] | null = null;

export function searchAssuranceHelp(query: unknown): HelpSearchResult[] {
  const sections = (process.env.NODE_ENV === 'production' && sectionCache)
    || loadAllHelpDocs().flatMap(d => buildHelpSections(d.entry.slug, d.doc));
  sectionCache = sections;
  return searchHelp(sections, query);
}

/** First paragraph under "## Purpose" (work instructions) or the first paragraph, as a summary. */
export function helpSummary(d: LoadedHelpDoc): string | null {
  const blocks = d.doc.blocks;
  const purpose = blocks.findIndex(b => b.type === 'heading' && /^purpose$/i.test(b.id));
  const from = purpose >= 0 ? purpose + 1 : 0;
  for (let i = from; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'paragraph') {
      const t = inlineText(b.children).trim();
      if (t) return t.length > 220 ? `${t.slice(0, 217)}…` : t;
    }
    if (b.type === 'heading' && purpose >= 0) break;
  }
  return null;
}
