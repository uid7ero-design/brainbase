export default function DashboardLoading() {
  return (
    <main className="bb-loading-page">
      <div className="bb-loading-ambient bb-loading-ambient-one" />
      <div className="bb-loading-ambient bb-loading-ambient-two" />

      <div className="bb-loading-shell">
        {/* Header */}
        <div className="bb-loading-header">
          <div>
            <div className="bb-skeleton bb-skeleton-small" />
            <div className="bb-skeleton bb-skeleton-heading" />
            <div className="bb-skeleton bb-skeleton-subheading" />
          </div>

          <div className="bb-loading-status">
            <span className="bb-loading-status-dot" />

            <div>
              <div className="bb-skeleton bb-status-line-one" />
              <div className="bb-skeleton bb-status-line-two" />
            </div>
          </div>
        </div>

        {/* KPI cards */}
        <div className="bb-kpi-grid">
          {Array.from({ length: 4 }).map((_, index) => (
            <div className="bb-loading-card bb-kpi-card" key={index}>
              <div className="bb-card-top">
                <div className="bb-skeleton bb-icon-placeholder" />
                <div className="bb-skeleton bb-mini-pill" />
              </div>

              <div className="bb-skeleton bb-kpi-value" />
              <div className="bb-skeleton bb-kpi-label" />
            </div>
          ))}
        </div>

        {/* Main content */}
        <div className="bb-main-grid">
          <section className="bb-loading-card bb-large-panel">
            <div className="bb-panel-heading">
              <div>
                <div className="bb-skeleton bb-panel-title" />
                <div className="bb-skeleton bb-panel-subtitle" />
              </div>

              <div className="bb-skeleton bb-panel-action" />
            </div>

            <div className="bb-chart-area">
              <div className="bb-chart-grid-line bb-chart-grid-line-one" />
              <div className="bb-chart-grid-line bb-chart-grid-line-two" />
              <div className="bb-chart-grid-line bb-chart-grid-line-three" />
              <div className="bb-chart-grid-line bb-chart-grid-line-four" />

              <div className="bb-loading-chart-bars">
                {[34, 48, 43, 66, 54, 76, 62].map((height, index) => (
                  <div
                    key={index}
                    className="bb-loading-chart-bar"
                    style={{
                      height: `${height}%`,
                      animationDelay: `${index * 80}ms`,
                    }}
                  />
                ))}
              </div>
            </div>
          </section>

          <section className="bb-loading-card bb-side-panel">
            <div className="bb-panel-heading">
              <div>
                <div className="bb-skeleton bb-panel-title-short" />
                <div className="bb-skeleton bb-panel-subtitle-short" />
              </div>
            </div>

            <div className="bb-list">
              {Array.from({ length: 5 }).map((_, index) => (
                <div className="bb-list-item" key={index}>
                  <div className="bb-skeleton bb-avatar-placeholder" />

                  <div className="bb-list-copy">
                    <div className="bb-skeleton bb-list-title" />
                    <div className="bb-skeleton bb-list-subtitle" />
                  </div>

                  <div className="bb-skeleton bb-list-pill" />
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Lower panels */}
        <div className="bb-lower-grid">
          <section className="bb-loading-card bb-lower-panel">
            <div className="bb-panel-heading">
              <div>
                <div className="bb-skeleton bb-panel-title" />
                <div className="bb-skeleton bb-panel-subtitle" />
              </div>
            </div>

            <div className="bb-list">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="bb-list-item" key={index}>
                  <div className="bb-skeleton bb-avatar-placeholder" />

                  <div className="bb-list-copy">
                    <div className="bb-skeleton bb-list-title-wide" />
                    <div className="bb-skeleton bb-list-subtitle" />
                  </div>

                  <div className="bb-skeleton bb-list-pill-small" />
                </div>
              ))}
            </div>
          </section>

          <section className="bb-loading-card bb-lower-panel">
            <div className="bb-panel-heading">
              <div>
                <div className="bb-skeleton bb-panel-title" />
                <div className="bb-skeleton bb-panel-subtitle" />
              </div>
            </div>

            <div className="bb-list">
              {Array.from({ length: 4 }).map((_, index) => (
                <div className="bb-list-item" key={index}>
                  <div className="bb-skeleton bb-avatar-placeholder" />

                  <div className="bb-list-copy">
                    <div className="bb-skeleton bb-list-title" />
                    <div className="bb-skeleton bb-list-subtitle" />
                  </div>

                  <div className="bb-skeleton bb-list-pill-small" />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <style>{`
        @keyframes bbShimmer {
          0% {
            background-position: 200% 0;
          }

          100% {
            background-position: -200% 0;
          }
        }

        @keyframes bbPulse {
          0%, 100% {
            opacity: 0.55;
          }

          50% {
            opacity: 1;
          }
        }

        @keyframes bbBarPulse {
          0%, 100% {
            opacity: 0.22;
          }

          50% {
            opacity: 0.45;
          }
        }

        .bb-loading-page {
          min-height: 100vh;
          position: relative;
          overflow: hidden;
          background: #08090c;
          color: #f5f7fa;
          font-family:
            var(--font-inter),
            "Inter",
            -apple-system,
            BlinkMacSystemFont,
            "Segoe UI",
            sans-serif;
        }

        .bb-loading-ambient {
          position: fixed;
          pointer-events: none;
          border-radius: 999px;
          filter: blur(10px);
        }

        .bb-loading-ambient-one {
          width: 800px;
          height: 480px;
          top: -320px;
          left: 50%;
          transform: translateX(-50%);
          background:
            radial-gradient(
              ellipse,
              rgba(139, 92, 246, 0.14) 0%,
              rgba(139, 92, 246, 0.035) 45%,
              transparent 72%
            );
        }

        .bb-loading-ambient-two {
          width: 500px;
          height: 500px;
          right: -280px;
          top: 34%;
          background:
            radial-gradient(
              circle,
              rgba(65, 85, 245, 0.05),
              transparent 70%
            );
        }

        .bb-loading-shell {
          position: relative;
          z-index: 1;
          width: 100%;
          max-width: 1240px;
          margin: 0 auto;
          padding: 42px 32px 90px;
        }

        .bb-loading-header {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 28px;
          margin-bottom: 30px;
        }

        .bb-loading-status {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 11px 14px;
          border-radius: 11px;
          border: 1px solid rgba(255, 255, 255, 0.065);
          background: rgba(255, 255, 255, 0.025);
        }

        .bb-loading-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #8b5cf6;
          box-shadow: 0 0 12px rgba(139, 92, 246, 0.45);
          animation: bbPulse 1.6s ease-in-out infinite;
        }

        .bb-skeleton {
          position: relative;
          overflow: hidden;
          border-radius: 7px;
          background:
            linear-gradient(
              90deg,
              rgba(255, 255, 255, 0.035) 0%,
              rgba(255, 255, 255, 0.075) 45%,
              rgba(255, 255, 255, 0.035) 100%
            );
          background-size: 220% 100%;
          animation: bbShimmer 1.8s ease-in-out infinite;
        }

        .bb-skeleton-small {
          width: 104px;
          height: 9px;
          margin-bottom: 12px;
        }

        .bb-skeleton-heading {
          width: 310px;
          max-width: 62vw;
          height: 28px;
          margin-bottom: 11px;
        }

        .bb-skeleton-subheading {
          width: 390px;
          max-width: 70vw;
          height: 11px;
        }

        .bb-status-line-one {
          width: 84px;
          height: 9px;
          margin-bottom: 6px;
        }

        .bb-status-line-two {
          width: 61px;
          height: 7px;
        }

        .bb-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 14px;
        }

        .bb-loading-card {
          border: 1px solid rgba(255, 255, 255, 0.065);
          background: rgba(255, 255, 255, 0.027);
          border-radius: 14px;
          backdrop-filter: blur(10px);
        }

        .bb-kpi-card {
          padding: 18px;
          min-height: 142px;
        }

        .bb-card-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 21px;
        }

        .bb-icon-placeholder {
          width: 34px;
          height: 34px;
          border-radius: 9px;
        }

        .bb-mini-pill {
          width: 44px;
          height: 16px;
          border-radius: 999px;
        }

        .bb-kpi-value {
          width: 74px;
          height: 24px;
          margin-bottom: 10px;
        }

        .bb-kpi-label {
          width: 112px;
          max-width: 78%;
          height: 9px;
        }

        .bb-main-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.55fr) minmax(280px, 0.75fr);
          gap: 14px;
          margin-bottom: 14px;
        }

        .bb-large-panel,
        .bb-side-panel,
        .bb-lower-panel {
          padding: 20px;
        }

        .bb-large-panel,
        .bb-side-panel {
          min-height: 345px;
        }

        .bb-panel-heading {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 23px;
        }

        .bb-panel-title {
          width: 142px;
          height: 12px;
          margin-bottom: 8px;
        }

        .bb-panel-title-short {
          width: 108px;
          height: 12px;
          margin-bottom: 8px;
        }

        .bb-panel-subtitle {
          width: 218px;
          max-width: 60vw;
          height: 8px;
        }

        .bb-panel-subtitle-short {
          width: 146px;
          height: 8px;
        }

        .bb-panel-action {
          width: 74px;
          height: 26px;
          border-radius: 999px;
        }

        .bb-chart-area {
          position: relative;
          overflow: hidden;
          height: 245px;
          border-radius: 10px;
          background:
            linear-gradient(
              180deg,
              rgba(255, 255, 255, 0.017),
              rgba(255, 255, 255, 0.006)
            );
        }

        .bb-chart-grid-line {
          position: absolute;
          left: 0;
          right: 0;
          height: 1px;
          background: rgba(255, 255, 255, 0.035);
        }

        .bb-chart-grid-line-one {
          top: 20%;
        }

        .bb-chart-grid-line-two {
          top: 40%;
        }

        .bb-chart-grid-line-three {
          top: 60%;
        }

        .bb-chart-grid-line-four {
          top: 80%;
        }

        .bb-loading-chart-bars {
          position: absolute;
          left: 24px;
          right: 24px;
          bottom: 18px;
          top: 18px;
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 13px;
        }

        .bb-loading-chart-bar {
          flex: 1;
          max-width: 56px;
          min-width: 18px;
          border-radius: 5px 5px 2px 2px;
          background:
            linear-gradient(
              180deg,
              rgba(139, 92, 246, 0.34),
              rgba(139, 92, 246, 0.08)
            );
          border: 1px solid rgba(139, 92, 246, 0.08);
          animation: bbBarPulse 1.7s ease-in-out infinite;
        }

        .bb-list {
          display: flex;
          flex-direction: column;
        }

        .bb-list-item {
          min-height: 56px;
          display: flex;
          align-items: center;
          gap: 11px;
          border-top: 1px solid rgba(255, 255, 255, 0.045);
        }

        .bb-list-item:first-child {
          border-top: 0;
        }

        .bb-avatar-placeholder {
          width: 31px;
          height: 31px;
          flex-shrink: 0;
          border-radius: 8px;
        }

        .bb-list-copy {
          flex: 1;
          min-width: 0;
        }

        .bb-list-title {
          width: 104px;
          max-width: 74%;
          height: 9px;
          margin-bottom: 7px;
        }

        .bb-list-title-wide {
          width: 142px;
          max-width: 82%;
          height: 9px;
          margin-bottom: 7px;
        }

        .bb-list-subtitle {
          width: 76px;
          height: 7px;
        }

        .bb-list-pill {
          width: 48px;
          height: 18px;
          flex-shrink: 0;
          border-radius: 999px;
        }

        .bb-list-pill-small {
          width: 36px;
          height: 16px;
          flex-shrink: 0;
          border-radius: 999px;
        }

        .bb-lower-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }

        .bb-lower-panel {
          min-height: 280px;
        }

        @media (max-width: 950px) {
          .bb-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .bb-main-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 700px) {
          .bb-loading-shell {
            padding: 30px 20px 64px;
          }

          .bb-loading-header {
            align-items: flex-start;
            flex-direction: column;
          }

          .bb-lower-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 500px) {
          .bb-loading-shell {
            padding: 24px 16px 52px;
          }

          .bb-kpi-grid {
            grid-template-columns: 1fr 1fr;
            gap: 9px;
          }

          .bb-kpi-card {
            min-height: 128px;
            padding: 15px;
          }

          .bb-main-grid,
          .bb-lower-grid {
            gap: 9px;
          }

          .bb-large-panel,
          .bb-side-panel,
          .bb-lower-panel {
            padding: 17px;
          }

          .bb-loading-status {
            display: none;
          }

          .bb-chart-area {
            height: 210px;
          }

          .bb-loading-chart-bars {
            gap: 7px;
            left: 12px;
            right: 12px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .bb-skeleton,
          .bb-loading-status-dot,
          .bb-loading-chart-bar {
            animation: none !important;
          }
        }
      `}</style>
    </main>
  );
}