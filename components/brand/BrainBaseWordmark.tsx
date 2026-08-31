'use client';

import Image from 'next/image';
import type { CSSProperties } from 'react';

// Phase D.1 — the approved Hybrid Orbit horizontal wordmark/lockup, copied
// from the approved brand kit (logos/brainbase-horizontal-color.svg,
// "supersedes all earlier BrainBase landscape logo files" per the kit's own
// README). Static corporate/product mark only — distinct from the living
// Helena assistant visual (components/brand/HelenaOrbital.tsx). Never use
// this for anything that should move/animate/react to conversation state.
//
// Designed for dark surfaces only (the wordmark glyphs render in the
// palette's light "primary text" colour, #F4F6FB) — every current consumer
// (TopNav, /hlna header, login, homepage) is already a dark background.
const NATURAL_WIDTH = 900;
const NATURAL_HEIGHT = 160;

type BrainBaseWordmarkProps = {
  /** Rendered width in px; height follows automatically at the asset's own aspect ratio. */
  width?: number;
  className?: string;
  style?: CSSProperties;
};

export function BrainBaseWordmark({
  width = 180,
  className,
  style,
}: BrainBaseWordmarkProps) {
  return (
    <Image
      src="/Brand/brainbase-horizontal-color.svg"
      alt="BRΛINBΛSE"
      width={NATURAL_WIDTH}
      height={NATURAL_HEIGHT}
      priority
      className={className}
      style={{
        display: 'block',
        width,
        height: 'auto',
        maxWidth: 'none',
        ...style,
      }}
    />
  );
}
