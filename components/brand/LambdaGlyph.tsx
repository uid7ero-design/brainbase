import type { CSSProperties } from "react";

/** The stylised, flat-topped "lambda/A" used in place of "A" in the
 * BRΛINBΛSE wordmark.
 *
 * A plain Unicode "Λ" (Greek capital lambda) renders with whatever apex,
 * cap-height and baseline the surrounding font happens to give it — in
 * practice a pointed tip that does not match the flat-topped, exact
 * cap-height letterform the brand requires. This draws that letterform as a
 * real, deterministic SVG path instead of relying on a borrowed character
 * or font metrics.
 *
 * Sizing is calibrated against the wordmark's own font (Geist Mono 600),
 * measured directly via `CanvasRenderingContext2D.measureText('B')
 * .actualBoundingBoxAscent` — the browser's own pixel-accurate ink cap-
 * height, not an assumed/guessed em-fraction: at 13.12px that font's cap
 * height is exactly 10px, i.e. 0.7622em, and that ratio is constant across
 * sizes for a given font (font metrics scale linearly with font-size). The
 * SVG's CSS box is set to exactly that height with `verticalAlign:
 * "baseline"`, which by definition sits the box's bottom edge on the text
 * baseline and its top edge `0.7622em` above it — i.e. exactly on the
 * neighbouring capitals' own cap-height line, with no separate vertical
 * offset/fudge factor needed.
 *
 * The previous attempt at this shape (a CSS `clip-path` on a filled span)
 * used a flat top only ~25% of the glyph's own width — at typical wordmark
 * sizes (13-16px) that is 2-3px, thin enough that anti-aliasing makes it
 * read as a point rather than a flat edge. This path's flat top is 40% of
 * the glyph's width, which stays visibly flat down to the smallest sizes
 * this wordmark is used at.
 */
const GLYPH_PATH = "M0 100 L30 0 L70 0 L100 100 L82 100 L50 42 L18 100 Z";

const SHAPE: CSSProperties = {
  display: "inline-block",
  flexShrink: 0,
  width: "0.7622em",
  height: "0.7622em",
  verticalAlign: "baseline",
};

export function LambdaGlyph() {
  return (
    <svg
      viewBox="0 0 100 100"
      style={SHAPE}
      aria-hidden="true"
      focusable="false"
      role="presentation"
      pointerEvents="none"
    >
      <path d={GLYPH_PATH} fill="var(--brand-brainbase-accent)" />
    </svg>
  );
}
