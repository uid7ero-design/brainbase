// Phase D2 — the /dashboard loading state mirrors the converged dashboard
// (header → metric strip → panels) on theme tokens: no ambient glow, no
// blur, no violet shimmer. It is announced once as a busy region; the
// placeholder blocks themselves are decorative.
import styles from './loading.module.css';

export default function DashboardLoading() {
  return (
    <main className={styles.page} aria-busy="true" aria-label="Loading dashboard">
      <div className={styles.header} aria-hidden="true">
        <div className={styles.block} style={{ width: 180, height: 22 }} />
        <div className={styles.block} style={{ width: 120, height: 10, marginTop: 8 }} />
      </div>

      <div className={styles.strip} aria-hidden="true">
        {Array.from({ length: 4 }).map((_, index) => (
          <div className={styles.cell} key={index}>
            <div className={styles.block} style={{ width: 72, height: 8 }} />
            <div className={styles.block} style={{ width: 96, height: 18, marginTop: 8 }} />
          </div>
        ))}
      </div>

      <div className={styles.grid} aria-hidden="true">
        {Array.from({ length: 2 }).map((_, panel) => (
          <div className={styles.panel} key={panel}>
            <div className={styles.block} style={{ width: 140, height: 10 }} />
            {Array.from({ length: 4 }).map((__, row) => (
              <div className={styles.row} key={row}>
                <div className={styles.block} style={{ width: '60%', height: 9 }} />
                <div className={styles.block} style={{ width: 48, height: 9 }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <span className={styles.srOnly}>Loading…</span>
    </main>
  );
}
