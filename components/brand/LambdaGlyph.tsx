import type { CSSProperties } from "react";

/** BrainBase's flat-top lambda uses the Geist Light A contour without its
 * crossbar, matching the wordmark's actual Geist 300 face rather than a
 * separately stroked chevron. The font's cap height, advance and side bearings
 * are preserved, with the same trailing tracking as the surrounding letters.
 *
 * Outline derived from Geist. Copyright 2024 The Geist Project Authors
 * (https://github.com/vercel/geist-font), SIL Open Font License 1.1.
 * License: /Brand/geist-OFL.txt. Only the glyph outline is font-derived.
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
        transform="translate(0 710) scale(1 -1)"
        d="M21.33 0 279.67 710H369.67L628 0H554.33L324.67 649.33L95 0Z"
        fill="var(--brand-brainbase-accent)"
      />
    </svg>
  );
}
