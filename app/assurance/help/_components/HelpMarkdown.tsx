import Link from 'next/link';
import type { ReactNode } from 'react';
import { TableContainer, tableStyles } from '@/components/ui/app';
import type { HelpBlock, HelpInline } from '@/lib/assurance/help/markdown';
import styles from '../../_components/assurance.module.css';

// Renders the limited Help AST (lib/assurance/help/markdown.ts) as React
// elements. Every piece of document text is emitted as a React text node —
// React escapes it — and nothing is ever injected as HTML. Links arrive
// already resolved by the Help registry: internal links use next/link,
// external (https only) links open safely in a new tab.

export function HelpMarkdown({ blocks }: { blocks: HelpBlock[] }) {
  return <div className={styles.helpDoc}>{renderBlocks(blocks, 'b')}</div>;
}

function renderBlocks(blocks: HelpBlock[], keyPrefix: string): ReactNode[] {
  return blocks.map((b, i) => renderBlock(b, `${keyPrefix}-${i}`));
}

function renderBlock(b: HelpBlock, key: string): ReactNode {
  switch (b.type) {
    case 'heading': {
      const level = Math.min(Math.max(b.level, 2), 4) as 2 | 3 | 4;
      const Tag = (`h${level}`) as 'h2' | 'h3' | 'h4';
      return <Tag key={key} id={b.id}>{renderInlines(b.children, key)}</Tag>;
    }
    case 'paragraph':
      return <p key={key}>{renderInlines(b.children, key)}</p>;
    case 'list': {
      const items = b.items.map((item, i) => {
        // Tight items (a single paragraph) render without a <p>.
        const only = item.length === 1 && item[0].type === 'paragraph' ? item[0] : null;
        return <li key={`${key}-${i}`}>{only ? renderInlines(only.children, `${key}-${i}`) : renderBlocks(item, `${key}-${i}`)}</li>;
      });
      return b.ordered
        ? <ol key={key} start={b.start !== 1 ? b.start : undefined}>{items}</ol>
        : <ul key={key}>{items}</ul>;
    }
    case 'table':
      return (
        <div key={key} className={styles.helpTable}>
          <TableContainer label="Table" minWidth={420}>
            <table className={tableStyles.table}>
              <thead>
                <tr>{b.header.map((c, i) => <th key={i} scope="col">{renderInlines(c, `${key}-h${i}`)}</th>)}</tr>
              </thead>
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>{r.map((c, ci) => <td key={ci}>{renderInlines(c, `${key}-${ri}-${ci}`)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </TableContainer>
        </div>
      );
    case 'blockquote':
      return <blockquote key={key}>{renderBlocks(b.children, key)}</blockquote>;
    case 'code':
      return <pre key={key}><code>{b.text}</code></pre>;
    case 'rule':
      return <hr key={key} />;
  }
}

function renderInlines(nodes: HelpInline[], keyPrefix: string): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyPrefix}.${i}`;
    switch (n.type) {
      case 'text':
        return n.text;
      case 'code':
        return <code key={key}>{n.text}</code>;
      case 'strong':
        return <strong key={key}>{renderInlines(n.children, key)}</strong>;
      case 'link':
        return n.href.kind === 'internal'
          ? <Link key={key} href={n.href.href}>{renderInlines(n.children, key)}</Link>
          : <a key={key} href={n.href.href} target="_blank" rel="noopener noreferrer">{renderInlines(n.children, key)}</a>;
    }
  });
}
