// BrainBase Assurance — deliberately limited Markdown for in-app Help.
//
// ZERO runtime imports (types only): pure text → AST, safe for server and
// client, easy to test. This is NOT a general Markdown engine. It supports
// exactly the syntax docs/assurance/** uses:
//
//   blocks : # headings (1–6) · paragraphs · "-" / "1." lists (nested by
//            indentation) · pipe tables · "> " blockquotes · ``` fenced code ·
//            --- rules
//   inline : **bold** · `code` · [text](link) · backslash escapes
//
// Everything else — raw HTML, images, single-star emphasis, autolinks,
// reference links, footnotes — is not interpreted: it stays LITERAL TEXT.
// The AST holds plain strings only; the React renderer emits them as text
// nodes (escaped by React), never as HTML. Links are resolved through the
// Help registry's allow-list; an unresolvable or unsafe href degrades to its
// link text.

import type { ResolvedHref } from './registry';

export type HelpInline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: HelpInline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: ResolvedHref; children: HelpInline[] };

export type HelpBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; id: string; children: HelpInline[] }
  | { type: 'paragraph'; children: HelpInline[] }
  | { type: 'list'; ordered: boolean; start: number; items: HelpBlock[][] }
  | { type: 'table'; header: HelpInline[][]; rows: HelpInline[][][] }
  | { type: 'blockquote'; children: HelpBlock[] }
  | { type: 'code'; text: string }
  | { type: 'rule' };

export type HelpHeading = { level: number; id: string; text: string };

export type ParsedHelpDoc = {
  /** Plain text of the first level-1 heading (the document title), or null. */
  title: string | null;
  /** Blocks after the title heading. */
  blocks: HelpBlock[];
  /** Every heading (title excluded) with its unique anchor id, in order. */
  headings: HelpHeading[];
};

export type HrefResolver = (href: string) => ResolvedHref | null;
export type Slugify = (text: string) => string;

const MAX_DEPTH = 6;
const MAX_INPUT = 400_000;

// ── Inline ────────────────────────────────────────────────────────────────

const ESCAPABLE = /[\\`*_[\]()#+\-.!|>~]/;

export function parseInline(src: string, resolve: HrefResolver, depth = 0, allowLinks = true): HelpInline[] {
  const out: HelpInline[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ type: 'text', text: buf }); buf = ''; } };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\' && i + 1 < src.length && ESCAPABLE.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (ch === '`') {
      const end = src.indexOf('`', i + 1);
      if (end > i + 1) {
        flush();
        out.push({ type: 'code', text: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }
    if (ch === '*' && src[i + 1] === '*' && depth < MAX_DEPTH) {
      const end = src.indexOf('**', i + 2);
      if (end > i + 2) {
        flush();
        out.push({ type: 'strong', children: parseInline(src.slice(i + 2, end), resolve, depth + 1, allowLinks) });
        i = end + 2;
        continue;
      }
    }
    if (ch === '[' && allowLinks && depth < MAX_DEPTH) {
      const close = findClosingBracket(src, i);
      if (close > i && src[close + 1] === '(') {
        const hrefEnd = findClosingParen(src, close + 1);
        if (hrefEnd > close + 1) {
          const label = src.slice(i + 1, close);
          const href = src.slice(close + 2, hrefEnd);
          const children = parseInline(label, resolve, depth + 1, false);
          flush();
          const resolved = resolve(href);
          if (resolved) out.push({ type: 'link', href: resolved, children });
          else out.push(...children); // unsafe / unknown target → just the text
          i = hrefEnd + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return mergeText(out);
}

/** Matching ')' for the '(' at `open`, allowing balanced parentheses inside the href. */
function findClosingParen(src: string, open: number): number {
  let level = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '(') level++;
    else if (src[j] === ')') { level--; if (level === 0) return j; }
  }
  return -1;
}

function findClosingBracket(src: string, open: number): number {
  let level = 0;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === '[') level++;
    else if (src[j] === ']') { level--; if (level === 0) return j; }
  }
  return -1;
}

function mergeText(nodes: HelpInline[]): HelpInline[] {
  const out: HelpInline[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (n.type === 'text' && last?.type === 'text') last.text += n.text;
    else out.push(n);
  }
  return out;
}

export function inlineText(nodes: HelpInline[]): string {
  return nodes.map(n => (n.type === 'text' || n.type === 'code' ? n.text : inlineText(n.children))).join('');
}

// ── Blocks ────────────────────────────────────────────────────────────────

const RE_FENCE = /^\s{0,3}```/;
const RE_HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RE_RULE = /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const RE_QUOTE = /^\s{0,3}>/;
const RE_ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const RE_TABLE_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const indentOf = (l: string) => l.length - l.trimStart().length;
const isBlank = (l: string) => l.trim() === '';
const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);

type Ctx = { resolve: HrefResolver; slugify: Slugify; ids: Map<string, number>; headings: HelpHeading[] };

function startsBlock(lines: string[], i: number): boolean {
  const l = lines[i];
  return RE_FENCE.test(l) || RE_HEADING.test(l) || RE_RULE.test(l) || RE_QUOTE.test(l)
    || (RE_ITEM.test(l) && indentOf(l) < 4)
    || (isTableRow(l) && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1]));
}

function splitRow(row: string): string[] {
  let s = row.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  for (let k = 0; k < s.length; k++) {
    if (s[k] === '\\' && s[k + 1] === '|') { cur += '|'; k++; continue; }
    if (s[k] === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += s[k];
  }
  cells.push(cur.trim());
  return cells;
}

function parseBlocks(lines: string[], ctx: Ctx, depth: number): HelpBlock[] {
  const blocks: HelpBlock[] = [];
  let i = 0;
  const para = (text: string) => blocks.push({ type: 'paragraph', children: parseInline(text, ctx.resolve) });

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    if (RE_FENCE.test(line)) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !RE_FENCE.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (an unclosed fence simply runs to the end: still plain text)
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    const h = RE_HEADING.exec(line);
    if (h) {
      const children = parseInline(h[2], ctx.resolve);
      const text = inlineText(children);
      const base = ctx.slugify(text);
      const n = (ctx.ids.get(base) ?? 0) + 1;
      ctx.ids.set(base, n);
      const id = n === 1 ? base : `${base}-${n}`;
      const level = h[1].length as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', level, id, children });
      ctx.headings.push({ level, id, text });
      i++;
      continue;
    }

    if (RE_RULE.test(line)) { blocks.push({ type: 'rule' }); i++; continue; }

    if (isTableRow(line) && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1])) {
      const header = splitRow(line).map(c => parseInline(c, ctx.resolve));
      i += 2;
      const rows: HelpInline[][][] = [];
      while (i < lines.length && isTableRow(lines[i])) {
        const cells = splitRow(lines[i]).map(c => parseInline(c, ctx.resolve));
        while (cells.length < header.length) cells.push([]);
        rows.push(cells.slice(0, header.length));
        i++;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    if (RE_QUOTE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && RE_QUOTE.test(lines[i])) inner.push(lines[i++].replace(/^\s{0,3}> ?/, ''));
      if (depth >= MAX_DEPTH) para(inner.join(' '));
      else blocks.push({ type: 'blockquote', children: parseBlocks(inner, ctx, depth + 1) });
      continue;
    }

    const item = RE_ITEM.exec(line);
    if (item && indentOf(line) < 4) {
      if (depth >= MAX_DEPTH) { para(line.trim()); i++; continue; }
      i = parseList(lines, i, ctx, depth, blocks);
      continue;
    }

    // Paragraph: consecutive lines until a blank line or another block starts.
    const text: string[] = [line.trim()];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) text.push(lines[i++].trim());
    para(text.join(' '));
  }
  return blocks;
}

function parseList(lines: string[], i: number, ctx: Ctx, depth: number, blocks: HelpBlock[]): number {
  const first = RE_ITEM.exec(lines[i])!;
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const start = ordered ? Math.min(parseInt(first[2], 10), 9999) : 1;
  const items: HelpBlock[][] = [];

  while (i < lines.length) {
    const m = RE_ITEM.exec(lines[i]);
    if (!m || m[1].length !== baseIndent || /\d/.test(m[2]) !== ordered) break;
    const contentIndent = baseIndent + m[2].length + 1;
    const itemLines: string[] = [m[3]];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (isBlank(l)) {
        let j = i + 1;
        while (j < lines.length && isBlank(lines[j])) j++;
        if (j < lines.length && indentOf(lines[j]) >= contentIndent) { itemLines.push(''); i++; continue; }
        break;
      }
      const ind = indentOf(l);
      const sibling = RE_ITEM.exec(l);
      if (sibling && ind <= baseIndent) break;
      if (ind > baseIndent) { itemLines.push(l.slice(Math.min(ind, contentIndent))); i++; continue; }
      break;
    }
    items.push(parseBlocks(itemLines, ctx, depth + 1));
    // A blank line between two items of the same list does not end the list.
    let j = i;
    while (j < lines.length && isBlank(lines[j])) j++;
    const next = j < lines.length ? RE_ITEM.exec(lines[j]) : null;
    if (next && next[1].length === baseIndent && /\d/.test(next[2]) === ordered) i = j;
    else break;
  }
  blocks.push({ type: 'list', ordered, start, items });
  return i;
}

/** Parses one Help document. `resolve` decides every link; `slugify` makes anchor ids. */
export function parseHelpMarkdown(source: string, resolve: HrefResolver, slugify: Slugify): ParsedHelpDoc {
  const text = String(source ?? '').slice(0, MAX_INPUT).replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  const ctx: Ctx = { resolve, slugify, ids: new Map(), headings: [] };
  const blocks = parseBlocks(text.split('\n'), ctx, 0);
  const titleIdx = blocks.findIndex(b => b.type === 'heading' && b.level === 1);
  let title: string | null = null;
  if (titleIdx !== -1) {
    const t = blocks[titleIdx] as Extract<HelpBlock, { type: 'heading' }>;
    title = inlineText(t.children);
    blocks.splice(titleIdx, 1);
    const hi = ctx.headings.findIndex(x => x.id === t.id);
    if (hi !== -1) ctx.headings.splice(hi, 1);
  }
  return { title, blocks, headings: ctx.headings };
}

/** Plain text of a block tree (for search). */
export function blocksText(blocks: HelpBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': case 'paragraph': parts.push(inlineText(b.children)); break;
      case 'list': for (const it of b.items) parts.push(blocksText(it)); break;
      case 'table': parts.push(b.header.map(inlineText).join(' ')); for (const r of b.rows) parts.push(r.map(inlineText).join(' ')); break;
      case 'blockquote': parts.push(blocksText(b.children)); break;
      case 'code': parts.push(b.text); break;
      case 'rule': break;
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
