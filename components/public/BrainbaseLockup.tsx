import type { CSSProperties } from "react";
import { BrokenOrbitMark } from "@/components/brand/BrokenOrbitMark";
import styles from "./BrainbaseLockup.module.css";

type BrainbaseLockupProps = {
  width?: number;
  idPrefix: string;
  className?: string;
  title?: string | null;
  style?: CSSProperties;
};

/** Theme-aware BrainBase product lockup using the approved broken-orbit product mark. */
export function BrainbaseLockup({
  width = 150,
  className,
  title = "BrainBase",
  style,
}: BrainbaseLockupProps) {
  const markSize = Math.max(20, Math.round(width * 0.17));
  return (
    <span
      className={[styles.lockup, className ?? ""].join(" ").trim()}
      style={{ width, ...style }}
      {...(title
        ? { role: "img", "aria-label": title }
        : { "aria-hidden": true })}
    >
      <BrokenOrbitMark size={markSize} context="brainbase" />
      <span className={styles.wordmark} aria-hidden="true">
        BRΛINBΛSE
      </span>
    </span>
  );
}
