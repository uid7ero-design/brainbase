'use client'

import { useEffect, useRef, useState } from 'react'

const FONT =
  "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

type Briefing = {
  greeting: string
  lines: string[]
  urgentCount: number
  summary: string
  hasData: boolean
}

const LINE_LABELS = [
  {
    label: 'Situation',
    color: '#60a5fa',
    bg: 'rgba(59,130,246,.055)',
    border: 'rgba(59,130,246,.16)',
  },
  {
    label: 'Context',
    color: 'rgba(255,255,255,.42)',
    bg: 'rgba(255,255,255,.025)',
    border: 'rgba(255,255,255,.07)',
  },
  {
    label: 'Risk',
    color: '#fbbf24',
    bg: 'rgba(251,191,36,.055)',
    border: 'rgba(251,191,36,.15)',
  },
  {
    label: 'Action',
    color: '#4ade80',
    bg: 'rgba(34,197,94,.06)',
    border: 'rgba(34,197,94,.16)',
  },
]

function LoadingPulse() {
  return (
    <div className="bb-hlna-loading">
      <div className="bb-hlna-loading-summary">
        <div className="bb-hlna-skeleton bb-hlna-skeleton-wide" />
        <div className="bb-hlna-skeleton bb-hlna-skeleton-medium" />
      </div>

      <div className="bb-hlna-loading-grid">
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className="bb-hlna-loading-card"
            style={{
              animationDelay: `${index * 80}ms`,
            }}
          >
            <div className="bb-hlna-skeleton bb-hlna-skeleton-label" />
            <div className="bb-hlna-skeleton bb-hlna-skeleton-line" />
            <div className="bb-hlna-skeleton bb-hlna-skeleton-short" />
          </div>
        ))}
      </div>
    </div>
  )
}

export default function HlnaInsightCard() {
  const [briefing, setBriefing] = useState<Briefing | null>(null)
  const [loading, setLoading] = useState(true)
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [asking, setAsking] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/hlna/briefing', { method: 'POST' })
      .then((response) => response.json())
      .then((data: Briefing) => {
        setBriefing(data)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [])

  async function handleAsk(e: { preventDefault(): void }) {
    e.preventDefault()

    const q = question.trim()

    if (!q || asking) return

    setQuestion('')
    setAsking(true)
    setAnswer('')

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: q,
            },
          ],
        }),
      })

      const data = await response.json()

      setAnswer(data.response ?? 'No response.')
    } catch {
      setAnswer('HLNΛ is unavailable right now.')
    }

    setAsking(false)
  }

  const urgent = briefing?.urgentCount ?? 0

  return (
    <section className="bb-hlna-card">
      <div className="bb-hlna-ambient bb-hlna-ambient-one" />
      <div className="bb-hlna-ambient bb-hlna-ambient-two" />

      <header className="bb-hlna-card-header">
        <div className="bb-hlna-brand">
          <div className="bb-hlna-mark">
            <span className="bb-hlna-mark-core">◈</span>
          </div>

          <div>
            <div className="bb-hlna-eyebrow">
              Intelligence Layer
            </div>

            <div className="bb-hlna-title">
              HLNΛ Insight
            </div>
          </div>
        </div>

        <div className="bb-hlna-header-right">
          <div className="bb-hlna-status">
            <span className="bb-hlna-status-dot" />
            Connected
          </div>

          {urgent > 0 && (
            <div className="bb-hlna-urgent">
              <span className="bb-hlna-urgent-dot" />
              {urgent} urgent
            </div>
          )}
        </div>
      </header>

      <div className="bb-hlna-content">
        {loading ? (
          <LoadingPulse />
        ) : !briefing?.hasData ? (
          <div className="bb-hlna-empty">
            <div className="bb-hlna-empty-icon">
              <svg
                width="23"
                height="23"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
              >
                <circle cx="12" cy="12" r="8" />
                <path d="M12 8v4" />
                <path d="M12 16h.01" />
              </svg>
            </div>

            <div className="bb-hlna-empty-title">
              No operational insight yet
            </div>

            <div className="bb-hlna-empty-copy">
              HLNΛ will surface priorities, risks and recommended actions as
              activity builds across the workspace.
            </div>
          </div>
        ) : (
          <>
            <div className="bb-hlna-summary-block">
              <div className="bb-hlna-summary-label">
                Current briefing
              </div>

              <p className="bb-hlna-summary">
                {briefing.summary}
              </p>
            </div>

            <div className="bb-hlna-insight-grid">
              {briefing.lines.map((line, index) => {
                const meta =
                  LINE_LABELS[index] ??
                  LINE_LABELS[1]

                return (
                  <div
                    key={index}
                    className={`bb-hlna-insight-item ${
                      index === 3
                        ? 'bb-hlna-insight-action'
                        : ''
                    }`}
                    style={{
                      background: meta.bg,
                      borderColor: meta.border,
                    }}
                  >
                    <div
                      className="bb-hlna-insight-accent"
                      style={{
                        background: meta.color,
                        boxShadow:
                          index === 3
                            ? '0 0 10px rgba(74,222,128,.22)'
                            : 'none',
                      }}
                    />

                    <div
                      className="bb-hlna-insight-label"
                      style={{
                        color: meta.color,
                      }}
                    >
                      {meta.label}
                    </div>

                    <div className="bb-hlna-insight-copy">
                      {line}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {answer && (
          <div className="bb-hlna-answer">
            <div className="bb-hlna-answer-header">
              <div className="bb-hlna-answer-mark">
                ◈
              </div>

              <div>
                <div className="bb-hlna-answer-eyebrow">
                  HLNΛ Response
                </div>

                <div className="bb-hlna-answer-title">
                  Operational answer
                </div>
              </div>
            </div>

            <p className="bb-hlna-answer-copy">
              {answer}
            </p>
          </div>
        )}
      </div>

      <form
        className="bb-hlna-ask-form"
        onSubmit={handleAsk}
      >
        <div className="bb-hlna-ask-icon">
          ◈
        </div>

        <input
          ref={inputRef}
          className="bb-hlna-ask-input"
          type="text"
          value={question}
          onChange={(e) =>
            setQuestion(e.target.value)
          }
          placeholder="Ask HLNΛ about your operation…"
          disabled={asking}
        />

        <button
          type="submit"
          className="bb-hlna-ask-button"
          disabled={!question.trim() || asking}
        >
          {asking ? (
            <>
              <span className="bb-hlna-thinking-dot" />
              Thinking
            </>
          ) : (
            <>
              Ask
              <span>→</span>
            </>
          )}
        </button>
      </form>

      <style>{`
        @keyframes bbHlnaPulse {
          0%, 100% {
            opacity: .65;
            box-shadow: 0 0 0 0 rgba(34,197,94,.18);
          }

          50% {
            opacity: 1;
            box-shadow: 0 0 0 5px rgba(34,197,94,0);
          }
        }

        @keyframes bbHlnaSkeleton {
          0% {
            background-position: 200% 0;
          }

          100% {
            background-position: -200% 0;
          }
        }

        @keyframes bbHlnaThinking {
          0%, 100% {
            opacity: .35;
            transform: scale(.8);
          }

          50% {
            opacity: 1;
            transform: scale(1);
          }
        }

        .bb-hlna-card {
          position: relative;
          overflow: hidden;
          border-radius: 15px;
          border: 1px solid rgba(139,92,246,.17);
          background:
            linear-gradient(
              120deg,
              rgba(99,102,241,.055),
              rgba(139,92,246,.025) 54%,
              rgba(255,255,255,.018)
            );
          font-family: ${FONT};
        }

        .bb-hlna-ambient {
          position: absolute;
          border-radius: 999px;
          pointer-events: none;
        }

        .bb-hlna-ambient-one {
          width: 280px;
          height: 280px;
          right: -120px;
          top: -150px;
          background:
            radial-gradient(
              circle,
              rgba(139,92,246,.13),
              transparent 70%
            );
        }

        .bb-hlna-ambient-two {
          width: 220px;
          height: 220px;
          left: -120px;
          bottom: -140px;
          background:
            radial-gradient(
              circle,
              rgba(59,130,246,.045),
              transparent 70%
            );
        }

        .bb-hlna-card-header {
          position: relative;
          z-index: 1;
          min-height: 68px;
          padding: 13px 19px;
          border-bottom:
            1px solid rgba(139,92,246,.11);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          background:
            rgba(99,102,241,.025);
        }

        .bb-hlna-brand {
          display: flex;
          align-items: center;
          gap: 11px;
        }

        .bb-hlna-mark {
          width: 36px;
          height: 36px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 10px;
          border:
            1px solid rgba(139,92,246,.23);
          background:
            rgba(139,92,246,.085);
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.03);
        }

        .bb-hlna-mark-core {
          font-size: 17px;
          color: rgba(196,181,253,.9);
          text-shadow:
            0 0 12px rgba(139,92,246,.3);
        }

        .bb-hlna-eyebrow {
          margin-bottom: 3px;
          font-size: 7px;
          line-height: 1;
          font-weight: 750;
          letter-spacing: .14em;
          text-transform: uppercase;
          color:
            rgba(167,139,250,.52);
        }

        .bb-hlna-title {
          font-size: 11px;
          font-weight: 720;
          line-height: 1.2;
          letter-spacing: .06em;
          text-transform: uppercase;
          color:
            rgba(245,247,250,.72);
        }

        .bb-hlna-header-right {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .bb-hlna-status,
        .bb-hlna-urgent {
          min-height: 24px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 3px 8px;
          border-radius: 999px;
          font-size: 7px;
          line-height: 1;
          font-weight: 750;
          letter-spacing: .055em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .bb-hlna-status {
          border:
            1px solid rgba(34,197,94,.14);
          background:
            rgba(34,197,94,.055);
          color:
            rgba(74,222,128,.65);
        }

        .bb-hlna-status-dot {
          width: 5px;
          height: 5px;
          border-radius: 999px;
          background: #22c55e;
          box-shadow:
            0 0 8px rgba(34,197,94,.35);
          animation:
            bbHlnaPulse 2.2s ease-in-out infinite;
        }

        .bb-hlna-urgent {
          border:
            1px solid rgba(251,191,36,.18);
          background:
            rgba(251,191,36,.07);
          color: rgba(251,191,36,.82);
        }

        .bb-hlna-urgent-dot {
          width: 5px;
          height: 5px;
          border-radius: 999px;
          background: #fbbf24;
          box-shadow:
            0 0 8px rgba(251,191,36,.25);
        }

        .bb-hlna-content {
          position: relative;
          z-index: 1;
          padding: 18px 19px 19px;
        }

        .bb-hlna-summary-block {
          margin-bottom: 15px;
          padding-bottom: 14px;
          border-bottom:
            1px solid rgba(255,255,255,.05);
        }

        .bb-hlna-summary-label {
          margin-bottom: 6px;
          font-size: 7px;
          line-height: 1;
          font-weight: 750;
          letter-spacing: .13em;
          text-transform: uppercase;
          color:
            rgba(167,139,250,.43);
        }

        .bb-hlna-summary {
          margin: 0;
          max-width: 900px;
          font-size: 13px;
          line-height: 1.65;
          font-weight: 520;
          color:
            rgba(245,247,250,.82);
        }

        .bb-hlna-insight-grid {
          display: grid;
          grid-template-columns:
            repeat(4, minmax(0, 1fr));
          gap: 9px;
        }

        .bb-hlna-insight-item {
          position: relative;
          overflow: hidden;
          min-height: 118px;
          padding: 13px 13px 13px 15px;
          border: 1px solid;
          border-radius: 11px;
        }

        .bb-hlna-insight-action {
          box-shadow:
            inset 0 1px 0 rgba(255,255,255,.02);
        }

        .bb-hlna-insight-accent {
          position: absolute;
          top: 13px;
          bottom: 13px;
          left: 0;
          width: 2px;
          border-radius:
            0 999px 999px 0;
        }

        .bb-hlna-insight-label {
          margin-bottom: 8px;
          font-size: 7px;
          font-weight: 800;
          letter-spacing: .13em;
          text-transform: uppercase;
        }

        .bb-hlna-insight-copy {
          font-size: 10.5px;
          line-height: 1.55;
          color:
            rgba(255,255,255,.55);
        }

        .bb-hlna-answer {
          margin-top: 15px;
          padding: 14px 15px;
          border-radius: 11px;
          border:
            1px solid rgba(139,92,246,.18);
          background:
            rgba(139,92,246,.065);
        }

        .bb-hlna-answer-header {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-bottom: 9px;
        }

        .bb-hlna-answer-mark {
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          border:
            1px solid rgba(139,92,246,.2);
          background:
            rgba(139,92,246,.09);
          color:
            rgba(196,181,253,.82);
          font-size: 13px;
        }

        .bb-hlna-answer-eyebrow {
          margin-bottom: 2px;
          font-size: 6.5px;
          font-weight: 750;
          letter-spacing: .13em;
          text-transform: uppercase;
          color:
            rgba(167,139,250,.5);
        }

        .bb-hlna-answer-title {
          font-size: 9px;
          font-weight: 700;
          color:
            rgba(245,247,250,.66);
        }

        .bb-hlna-answer-copy {
          margin: 0;
          font-size: 11px;
          line-height: 1.65;
          color:
            rgba(245,247,250,.68);
        }

        .bb-hlna-empty {
          min-height: 190px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px 20px;
          text-align: center;
        }

        .bb-hlna-empty-icon {
          width: 42px;
          height: 42px;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 11px;
          border:
            1px solid rgba(139,92,246,.16);
          background:
            rgba(139,92,246,.065);
          color:
            rgba(167,139,250,.68);
        }

        .bb-hlna-empty-title {
          margin-bottom: 5px;
          font-size: 12px;
          font-weight: 650;
          color:
            rgba(245,247,250,.72);
        }

        .bb-hlna-empty-copy {
          max-width: 420px;
          font-size: 10.5px;
          line-height: 1.6;
          color:
            rgba(255,255,255,.28);
        }

        .bb-hlna-loading {
          padding: 3px 0 2px;
        }

        .bb-hlna-loading-summary {
          margin-bottom: 15px;
          padding-bottom: 14px;
          border-bottom:
            1px solid rgba(255,255,255,.05);
        }

        .bb-hlna-loading-grid {
          display: grid;
          grid-template-columns:
            repeat(4, minmax(0, 1fr));
          gap: 9px;
        }

        .bb-hlna-loading-card {
          min-height: 118px;
          padding: 14px;
          border-radius: 11px;
          border:
            1px solid rgba(255,255,255,.05);
          background:
            rgba(255,255,255,.018);
        }

        .bb-hlna-skeleton {
          overflow: hidden;
          border-radius: 999px;
          background:
            linear-gradient(
              90deg,
              rgba(255,255,255,.035),
              rgba(255,255,255,.085),
              rgba(255,255,255,.035)
            );
          background-size: 220% 100%;
          animation:
            bbHlnaSkeleton 1.8s ease-in-out infinite;
        }

        .bb-hlna-skeleton-wide {
          width: 78%;
          height: 11px;
          margin-bottom: 8px;
        }

        .bb-hlna-skeleton-medium {
          width: 55%;
          height: 9px;
        }

        .bb-hlna-skeleton-label {
          width: 42%;
          height: 7px;
          margin-bottom: 12px;
        }

        .bb-hlna-skeleton-line {
          width: 100%;
          height: 8px;
          margin-bottom: 7px;
        }

        .bb-hlna-skeleton-short {
          width: 72%;
          height: 8px;
        }

        .bb-hlna-ask-form {
          position: relative;
          z-index: 1;
          min-height: 58px;
          padding: 10px 13px;
          display: flex;
          align-items: center;
          gap: 9px;
          border-top:
            1px solid rgba(139,92,246,.11);
          background:
            rgba(99,102,241,.022);
        }

        .bb-hlna-ask-icon {
          width: 30px;
          height: 30px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          border:
            1px solid rgba(139,92,246,.13);
          background:
            rgba(139,92,246,.055);
          color:
            rgba(167,139,250,.58);
          font-size: 12px;
        }

        .bb-hlna-ask-input {
          flex: 1;
          min-width: 0;
          height: 36px;
          padding: 0 3px;
          border: none;
          outline: none;
          background: transparent;
          color: #f5f7fa;
          font-size: 11px;
          font-family: ${FONT};
        }

        .bb-hlna-ask-input::placeholder {
          color:
            rgba(255,255,255,.22);
        }

        .bb-hlna-ask-input:disabled {
          opacity: .55;
        }

        .bb-hlna-ask-button {
          min-width: 74px;
          height: 34px;
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          border-radius: 8px;
          border:
            1px solid rgba(139,92,246,.28);
          background:
            rgba(139,92,246,.15);
          color:
            rgba(196,181,253,.85);
          font-size: 9px;
          font-weight: 700;
          font-family: ${FONT};
          letter-spacing: .02em;
          cursor: pointer;
          transition:
            background .16s ease,
            border-color .16s ease,
            color .16s ease,
            transform .16s ease;
        }

        .bb-hlna-ask-button:hover:not(:disabled) {
          transform: translateY(-1px);
          background:
            rgba(139,92,246,.23);
          border-color:
            rgba(167,139,250,.42);
          color: #ddd6fe;
        }

        .bb-hlna-ask-button:disabled {
          cursor: default;
          color:
            rgba(167,139,250,.32);
          background:
            rgba(139,92,246,.055);
          border-color:
            rgba(139,92,246,.1);
        }

        .bb-hlna-thinking-dot {
          width: 5px;
          height: 5px;
          border-radius: 999px;
          background:
            rgba(167,139,250,.8);
          animation:
            bbHlnaThinking 1s ease-in-out infinite;
        }

        @media (max-width: 880px) {
          .bb-hlna-insight-grid,
          .bb-hlna-loading-grid {
            grid-template-columns:
              repeat(2, minmax(0, 1fr));
          }
        }

        @media (max-width: 620px) {
          .bb-hlna-card-header {
            align-items: flex-start;
            padding: 13px 15px;
          }

          .bb-hlna-header-right {
            flex-direction: column;
            align-items: flex-end;
          }

          .bb-hlna-content {
            padding:
              16px 15px 17px;
          }

          .bb-hlna-insight-grid,
          .bb-hlna-loading-grid {
            grid-template-columns: 1fr;
          }

          .bb-hlna-insight-item {
            min-height: 0;
          }

          .bb-hlna-ask-form {
            padding-left: 10px;
            padding-right: 10px;
          }
        }

        @media (max-width: 430px) {
          .bb-hlna-status {
            display: none;
          }

          .bb-hlna-mark {
            width: 33px;
            height: 33px;
          }

          .bb-hlna-ask-icon {
            display: none;
          }

          .bb-hlna-ask-button {
            min-width: 62px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .bb-hlna-status-dot,
          .bb-hlna-skeleton,
          .bb-hlna-thinking-dot {
            animation: none !important;
          }

          .bb-hlna-ask-button {
            transition: none !important;
          }
        }
      `}</style>
    </section>
  )
}