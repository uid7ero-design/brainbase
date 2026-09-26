import type { CSSProperties } from "react";

type BrokenOrbitMarkProps = {
  size?: number;
  context?: "brainbase" | "hlna" | "mono";
  className?: string;
  style?: CSSProperties;
  title?: string | null;
};

/** Approved HLNA Labs broken-orbit geometry. Geometry is intentionally locked. */
export function BrokenOrbitMark({
  size = 24,
  context = "brainbase",
  className,
  style,
  title = null,
}: BrokenOrbitMarkProps) {
  const accent =
    context === "hlna"
      ? "var(--brand-hlna-accent)"
      : context === "brainbase"
        ? "var(--brand-brainbase-accent)"
        : "var(--brand-line)";

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      style={{ display: "block", flex: "0 0 auto", ...style }}
      xmlns="http://www.w3.org/2000/svg"
      {...(title
        ? { role: "img", "aria-label": title }
        : { "aria-hidden": true, focusable: "false" })}
    >
      <g transform="rotate(-30 50 50)">
        <path
          d="M88.64 43.79 A40 24 0 1 1 60.35 26.82"
          fill="none"
          stroke="var(--brand-line)"
          strokeWidth="4.5"
          strokeLinecap="round"
        />
        <circle cx="78.28" cy="33.03" r="6" fill="var(--brand-line)" />
      </g>
      <circle cx="50" cy="50" r="12" fill={accent} />
    </svg>
  );
}
