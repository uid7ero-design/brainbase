import type { CSSProperties } from "react";

/** Custom flat-top lambda calibrated to Geist 300: 710-unit cap height,
 * 649-unit advance and a 68-unit stroke, matching its capital I stem.
 * The broad horizontal crown stays visible at normal wordmark sizes.
 * Both diagonal legs have the same perpendicular thickness as the crown.
 * Spacing includes the wordmark's normal trailing tracking.
 */
const UNITS_PER_EM = 1000;
const SHAPE: CSSProperties = {
  display: "inline-block",
  flexShrink: 0,
  width: `${649 / UNITS_PER_EM}em`,
  height: `${710 / UNITS_PER_EM}em`,
  marginInlineEnd: "0.19em",
  verticalAlign: "baseline",
};

export function LambdaGlyph() {
  return (
    <svg
      viewBox="0 0 649 710"
      style={SHAPE}
      aria-hidden="true"
      focusable="false"
      role="presentation"
      pointerEvents="none"
    >
      <path
        d="M21.33 710 234 0H415L627.67 710H556.68L364.38 68H284.62L92.32 710Z"
        fill="var(--brand-brainbase-accent)"
      />
    </svg>
  );
}
