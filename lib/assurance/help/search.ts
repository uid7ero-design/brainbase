// BrainBase Assurance — in-app Help search. Pure (types-only imports).
//
// The index is built from the parsed, allow-listed Help documents only —
// never from arbitrary files. Each document is split into sections at its
// level-2/3 headings so a result links straight to the relevant anchor.
// Matching is plain case-insensitive substring search over text (no regex
// is built from the query, so user input cannot produce a pathological
// pattern). The query is bounded in length and term count.

import { blocksText, inlineText, type HelpBlock, type ParsedHelpDoc } from './markdown';

export type HelpSection = {
  slug: string;
  docTitle: string;
  heading: string | null;
  anchor: string | null;
  text: string;
};

export type HelpSearchResult = {
  slug: string;
  docTitle: string;
  heading: string | null;
  anchor: string | null;
  snippet: string;
  score: number;
};

export const MAX_QUERY_LENGTH = 100;
const MAX_TERMS = 8;
const MAX_RESULTS = 30;

export function buildHelpSections(slug: string, doc: ParsedHelpDoc): HelpSection[] {
  const docTitle = doc.title ?? slug;
  const sections: HelpSection[] = [];
  let current: HelpSection = { slug, docTitle, heading: null, anchor: null, text: '' };
  let acc: HelpBlock[] = [];
  const close = () => {
    current.text = blocksText(acc);
    if (current.text || current.heading) sections.push(current);
  };
  for (const b of doc.blocks) {
    if (b.type === 'heading' && (b.level === 2 || b.level === 3)) {
      close();
      current = { slug, docTitle, heading: inlineText(b.children), anchor: b.id, text: '' };
      acc = [];
    } else {
      acc.push(b);
    }
  }
  close();
  return sections;
}

/** Normalises user input into search terms (lower-case, bounded). */
export function helpQueryTerms(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const q = raw.slice(0, MAX_QUERY_LENGTH).toLowerCase().replace(/[\u0000-\u001f]/g, ' ');
  const terms = q.split(/\s+/).map(t => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(t => t.length >= 2);
  return [...new Set(terms)].slice(0, MAX_TERMS);
}

function count(hay: string, needle: string): number {
  let n = 0;
  let at = hay.indexOf(needle);
  while (at !== -1 && n < 50) { n++; at = hay.indexOf(needle, at + needle.length); }
  return n;
}

function snippetFor(text: string, terms: string[]): string {
  const lower = text.toLowerCase();
  const hits = terms.map(t => lower.indexOf(t)).filter(i => i >= 0);
  const at = hits.length ? Math.min(...hits) : 0;
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, start + 200);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

/** Every term must appear in the section (heading, document title or text). */
export function searchHelp(sections: HelpSection[], rawQuery: unknown): HelpSearchResult[] {
  const terms = helpQueryTerms(rawQuery);
  if (terms.length === 0) return [];
  const results: HelpSearchResult[] = [];
  for (const s of sections) {
    const heading = (s.heading ?? '').toLowerCase();
    const title = s.docTitle.toLowerCase();
    const text = s.text.toLowerCase();
    let score = 0;
    let all = true;
    for (const t of terms) {
      const inHeading = heading.includes(t);
      const inTitle = title.includes(t);
      const inText = count(text, t);
      if (!inHeading && !inTitle && inText === 0) { all = false; break; }
      score += (inHeading ? 8 : 0) + (inTitle ? 3 : 0) + Math.min(inText, 10);
    }
    if (!all) continue;
    results.push({ slug: s.slug, docTitle: s.docTitle, heading: s.heading, anchor: s.anchor, snippet: snippetFor(s.text || s.heading || '', terms), score });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, MAX_RESULTS);
}
