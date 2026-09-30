import type { CSSProperties } from "react";

/** The BrainBase wordmark's "Λ" (Greek capital lambda, standing in for "A")
 * in BRΛINBΛSE.
 *
 * Reproduces the approved reference wordmark (a thin/light geometric
 * lockup with generous tracking and a true pointed Lambda apex) as closely
 * as this codebase's own tools allow: a real font for the letters — not a
 * hand-approximated letterform — and a single hand-drawn `<path>` for the
 * two Lambda positions, sized/positioned deterministically against that
 * font's own measured metrics rather than guessed.
 *
 * The two prior approaches (a bold flat-topped A-trapezoid, then a
 * faithful reproduction of the BOLD brand-kit SVG's own lambda) were both
 * wrong for the SAME underlying reason once the actual reference image was
 * seen: this wordmark's surrounding letters are a thin/light weight, not
 * the Geist Mono 600 (semibold monospace) used everywhere before — no
 * lambda shape drawn at that heavier weight could ever read as "the same
 * visual stroke weight" as thin letters beside it. This is a thin,
 * OUTLINED chevron (stroke, not fill) — a simple V from one baseline
 * corner up to a single pointed apex and back down — matching how a thin
 * geometric sans actually draws a lambda, rather than the bold two-leg/
 * hollow-notch construction every previous attempt used.
 *
 * Cap-height is measured the same way as before —
 * `CanvasRenderingContext2D.measureText('B').actualBoundingBoxAscent` —
 * but against Geist Sans at weight 300 (this wordmark's own new font/
 * weight, matching the reference; see BrainbaseLockup.module.css), not
 * Geist Mono 600: 34px ascent at a 48px test size, i.e. 0.7083em, a
 * materially different ratio from the old 0.7622em precisely because it's
 * now a different typeface.
 */
const GLYPH_ASPECT = 0.72;
const CAP_HEIGHT_EM = 0.7083;

const SHAPE: CSSProperties = {
  display: "inline-block",
  flexShrink: 0,
  width: `${(CAP_HEIGHT_EM * GLYPH_ASPECT).toFixed(4)}em`,
  height: `${CAP_HEIGHT_EM}em`,
  verticalAlign: "baseline",
  overflow: "visible",
};

export function LambdaGlyph() {
  return (
    <svg
      viewBox="0 0 72 100"
      style={SHAPE}
      aria-hidden="true"
      focusable="false"
      role="presentation"
      pointerEvents="none"
    >
      <path
        d="M8 98 L36 3 L64 98"
        fill="none"
        stroke="var(--brand-brainbase-accent)"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
