import type { CSSProperties } from "react";

/** The stylised "Λ" used in place of "A" in the BRΛINBΛSE wordmark.
 *
 * A plain Unicode "Λ" (Greek capital lambda) renders with whatever apex,
 * cap-height and baseline the surrounding font happens to give it — in
 * practice a pointed tip that does not match the flat-topped, exact
 * cap-height letterform the brand requires. This draws that letterform
 * directly with a clipped `<span>` instead of relying on a borrowed
 * character (or an inline `<svg>`, which — even fully `aria-hidden` and
 * `focusable="false"` — can still register as a distinct accessibility-
 * tree/focus target in some environments): a flat-topped tent shape sized
 * in `em` so it scales with the surrounding text, sitting on the same
 * baseline as the Latin letters beside it, and always the accent purple
 * regardless of theme.
 */
const SHAPE: CSSProperties = {
  display: "inline-block",
  flexShrink: 0,
  width: "0.72em",
  height: "0.72em",
  verticalAlign: "-0.02em",
  background: "var(--brand-brainbase-accent)",
  clipPath: "polygon(0% 100%, 37.5% 13%, 62.5% 13%, 100% 100%, 73.3% 100%, 50% 31.7%, 26.7% 100%)",
};

export function LambdaGlyph() {
  return <span aria-hidden="true" style={SHAPE} />;
}
