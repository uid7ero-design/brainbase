"use client";

import type { CSSProperties } from "react";
import { BrainbaseLockup } from "@/components/public/BrainbaseLockup";

type BrainBaseWordmarkProps = {
  width?: number;
  className?: string;
  style?: CSSProperties;
};

/** Application lockup. Uses the same broken-orbit product geometry as the public site. */
export function BrainBaseWordmark({
  width = 180,
  className,
  style,
}: BrainBaseWordmarkProps) {
  return (
    <BrainbaseLockup
      idPrefix="bb-app-lockup"
      width={width}
      className={className}
      style={style}
      title="BrainBase"
    />
  );
}
