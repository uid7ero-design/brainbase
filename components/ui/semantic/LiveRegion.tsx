import type { Politeness } from './types';
import styles from './semantic.module.css';

export type LiveRegionProps = {
  /**
   * The current announcement. Render the LiveRegion before the first
   * message arrives and change only this prop — screen readers announce
   * changes to an already-present region, not a region's first mount.
   * Pass meaningful transitions ("Sync complete"), never rapidly changing
   * progress values.
   */
  message: string;
  /** polite (default) for routine updates; assertive only for critical failures. */
  politeness?: Politeness;
  /** Hide visually while still announcing (default true). */
  visuallyHidden?: boolean;
  id?: string;
};

export function LiveRegion({ message, politeness = 'polite', visuallyHidden = true, id }: LiveRegionProps) {
  return (
    <div
      id={id}
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      aria-atomic="true"
      className={visuallyHidden ? 'bb-visually-hidden' : styles.liveRegionVisible}
    >
      {message}
    </div>
  );
}
