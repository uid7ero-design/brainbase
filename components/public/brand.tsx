import type { ReactNode } from 'react';
import { LambdaGlyph } from '@/components/brand/LambdaGlyph';
import styles from './brand.module.css';

// Brand typography rule for the public site:
//  - Brand/display contexts (a standalone product label, mock-app chrome,
//    a diagram node) render the stylised wordmark via these components.
//  - Ordinary prose, headings, eyebrows and buttons use plain "BrainBase"
//    and "HLNA" — never a hand-typed Λ.
// The stylised glyphs are hidden from assistive technology (screen readers
// can read "Λ" as "lambda"); the plain name is exposed instead.

function Mark({ name, children, className }: { name: string; children: ReactNode; className?: string }) {
  return (
    <span className={[styles.mark, className ?? ''].join(' ').trim()}>
      <span aria-hidden="true">{children}</span>
      <span className="bb-visually-hidden">{name}</span>
    </span>
  );
}

/** BRΛINBΛSE wordmark text for display contexts. Routes the "A" positions
 * through the canonical LambdaGlyph (see its own header comment) rather
 * than a font-rendered "Λ" character, so this matches BrainbaseLockup's
 * treatment exactly. */
export function BrainBaseMark({ className }: { className?: string }) {
  return (
    <Mark
      name="BrainBase"
      className={[styles.brainBaseMarkOverride, className ?? ''].join(' ').trim()}
    >
      BR<LambdaGlyph />INB<LambdaGlyph />SE
    </Mark>
  );
}

/** HLNΛ wordmark text for display contexts. */
export function HlnaMark({ className }: { className?: string }) {
  return (
    <Mark name="HLNA" className={className}>
      HLN<span className={styles.lambda}>Λ</span>
    </Mark>
  );
}
