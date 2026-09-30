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
 * Shape is an OPTICAL match to the surrounding letters, not just a
 * bounding-box one — cap-height/baseline alone proved insufficient (a first
 * pass at this shape, width 100% of height but with thin ~18%-of-width legs
 * around a deep hollow notch, measured correctly but still read as a
 * pinched vertical stroke at real wordmark sizes: 12-14px legs that thin
 * anti-alias into near-invisibility). This path:
 *   - fills the FULL 100-unit width at the base (both outer legs run all
 *     the way to the glyph's own left/right edge — as wide as the box
 *     itself, not inset), so the glyph occupies the same footprint as a
 *     normal capital rather than a narrow mark centred in extra padding;
 *   - flat top spans 50% of that width (50 to 75 minus 25, i.e. x=25..75),
 *     wide enough to read as a horizontal edge rather than a point even at
 *     11px (the smallest live usage, the platform-map diagram);
 *   - legs are 32%-of-width thick (vs. the first pass's 18%) — heavier
 *     stroke mass, closer to the surrounding Geist Mono 600 letterforms —
 *     with the hollow notch apex at 62% of the height (not deeper), so the
 *     two legs stay visually distinct as a lambda rather than either
 *     collapsing into a thin double-line or filling in solid.
 * Verified by eye at 1x and 6x real render (not just measured) against all
 * four live usage sizes (public/login nav ~13px, centred login lockup
 * ~18px, platform-map diagram ~11px) — see the PR description for the
 * before/after comparison.
 */
const GLYPH_PATH = "M0 100 L25 0 L75 0 L100 100 L68 100 L50 62 L32 100 Z";

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
