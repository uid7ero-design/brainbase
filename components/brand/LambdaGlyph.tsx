import type { CSSProperties } from "react";

/** The BrainBase wordmark's "Λ" (Greek capital lambda, standing in for "A")
 * in BRΛINBΛSE.
 *
 * This reproduces the lambda geometry from BrainBase's own designer-made
 * brand asset — public/Brand/brainbase-horizontal-color.svg's wordmark path
 * — rather than inventing a new silhouette: that SVG already contains the
 * intended letterform (a genuine Lambda: two legs converging toward a small
 * flat facet at the apex, not a flat-topped A-style trapezoid), hand-drawn
 * by the original brand kit designer. This file extracts that exact path
 * (its two lambda glyphs are byte-identical), translates it to start at
 * (0,0), and rescales it to a 100-unit cap height — no other change to the
 * shape itself.
 *
 * A plain Unicode "Λ" character can't be used in its place: it renders with
 * whatever apex/cap-height/baseline the surrounding font happens to give
 * it, not the brand's own drawn letterform, and that varies by font/browser
 * with no way to pin it down. Reproducing the real path as SVG is
 * deterministic regardless of font or browser.
 *
 * Sizing is calibrated against the wordmark's own font (Geist Mono 600),
 * measured directly via `CanvasRenderingContext2D.measureText('B')
 * .actualBoundingBoxAscent` — the browser's own pixel-accurate ink cap-
 * height, not a guessed em-fraction: at 13.12px that font's cap height is
 * exactly 10px, i.e. 0.7622em, and that ratio is constant across sizes for
 * a given font (font metrics scale linearly with font-size). Height is set
 * to exactly that with `verticalAlign: "baseline"`, which by definition
 * sits the box's bottom edge on the text baseline and its top edge
 * `0.7622em` above it — exactly the neighbouring capitals' own cap-height
 * line. Width follows the source asset's own aspect ratio (0.719 — a
 * genuine letter's proportions, narrower than it is tall, unlike a square
 * A-trapezoid), not a separately guessed number.
 *
 * Two earlier attempts at this shape were both wrong in different ways,
 * kept here as the record of what NOT to do:
 *   1. A CSS `clip-path` on a filled `<span>`, flat top only ~25% of the
 *      glyph's own width — thin enough at 12-14px wordmark sizes that
 *      anti-aliasing erased the flat edge into an apparent point.
 *   2. A hand-drawn "wide flat-topped A" SVG path (full-width legs, 50%
 *      flat top) — fixed the height/point problem but was a genuinely
 *      different, invented silhouette: at real size it read as an A-shaped
 *      wedge, not a Lambda, and lost the brand's actual letterform. This
 *      file replaces that attempt with the real asset's own geometry.
 */
const GLYPH_PATH = "M0 100 L30 5 L33 0 L42 0 L72 100 L61 100 L38 22 L11 100 Z";
const GLYPH_ASPECT = 72 / 100;

const SHAPE: CSSProperties = {
  display: "inline-block",
  flexShrink: 0,
  width: `${(0.7622 * GLYPH_ASPECT).toFixed(4)}em`,
  height: "0.7622em",
  verticalAlign: "baseline",
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
      <path d={GLYPH_PATH} fill="var(--brand-brainbase-accent)" />
    </svg>
  );
}
