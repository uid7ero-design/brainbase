'use client'

import { useEffect, useRef, useState } from 'react'
import { BrokenOrbitMark } from '@/components/brand/BrokenOrbitMark'
import { Badge, StatusDot, buttonProps } from '@/components/ui/app'
import styles from './HlnaInsightCard.module.css'

type Briefing = {
  greeting: string
  lines: string[]
  urgentCount: number
  summary: string
  hasData: boolean
}

// Briefing line kinds keep their meaning (situation / context / risk /
// action) through status tokens in the module — see data-kind rules.
const LINE_LABELS: { label: string; kind: 'info' | 'neutral' | 'warning' | 'success' }[] = [
  {
    label: 'Situation',
    kind: 'info',
  },
  {
    label: 'Context',
    kind: 'neutral',
  },
  {
    label: 'Risk',
    kind: 'warning',
  },
  {
    label: 'Action',
    kind: 'success',
  },
]

function LoadingPulse() {
  return (
    <div className={styles.loading} role="status" aria-label="Loading briefing">
      <div className={styles.loadingSummary}>
        <div className={`${styles.skeleton} ${styles.skeletonWide}`} />
        <div className={`${styles.skeleton} ${styles.skeletonMedium}`} />
      </div>

      <div className={styles.loadingGrid}>
        {[0, 1, 2, 3].map((index) => (
          <div
            key={index}
            className={styles.loadingCard}
          >
            <div className={`${styles.skeleton} ${styles.skeletonLabel}`} />
            <div className={`${styles.skeleton} ${styles.skeletonLine}`} />
            <div className={`${styles.skeleton} ${styles.skeletonShort}`} />
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
    <section className={styles.card}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <div className={styles.mark}>
            <BrokenOrbitMark size={22} context="hlna" />
          </div>

          <div>
            <div className={styles.eyebrow}>
              Intelligence Layer
            </div>

            <h2 className={styles.title}>
              HLNΛ Insight
            </h2>
          </div>
        </div>

        <div className={styles.headerRight}>
          <StatusDot state="success" label="Connected" />

          {urgent > 0 && (
            <Badge state="warning">
              {urgent} urgent
            </Badge>
          )}
        </div>
      </header>

      <div className={styles.content}>
        {loading ? (
          <LoadingPulse />
        ) : !briefing?.hasData ? (
          <div className={styles.empty}>
            <div className={styles.emptyIcon} aria-hidden="true">
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

            <div className={styles.emptyTitle}>
              No operational insight yet
            </div>

            <div className={styles.emptyCopy}>
              HLNΛ will surface priorities, risks and recommended actions as
              activity builds across the workspace.
            </div>
          </div>
        ) : (
          <>
            <div className={styles.summaryBlock}>
              <div className={styles.summaryLabel}>
                Current briefing
              </div>

              <p className={styles.summary}>
                {briefing.summary}
              </p>
            </div>

            <ul className={styles.grid}>
              {briefing.lines.map((line, index) => {
                const meta =
                  LINE_LABELS[index] ??
                  LINE_LABELS[1]

                return (
                  <li
                    key={index}
                    className={styles.item}
                    data-kind={meta.kind}
                  >
                    <span className={styles.itemAccent} aria-hidden="true" />

                    <div className={styles.itemLabel}>
                      {meta.label}
                    </div>

                    <div className={styles.itemCopy}>
                      {line}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}

        <div aria-live="polite">
          {answer && (
            <div className={styles.answer}>
              <div className={styles.answerHeader}>
                <div className={styles.answerMark}>
                  <BrokenOrbitMark size={16} context="hlna" />
                </div>

                <div>
                  <div className={styles.answerEyebrow}>
                    HLNΛ Response
                  </div>

                  <div className={styles.answerTitle}>
                    Operational answer
                  </div>
                </div>
              </div>

              <p className={styles.answerCopy}>
                {answer}
              </p>
            </div>
          )}
        </div>
      </div>

      <form
        className={styles.askForm}
        onSubmit={handleAsk}
      >
        <div className={styles.askIcon}>
          <BrokenOrbitMark size={18} context="hlna" />
        </div>

        <input
          ref={inputRef}
          className={styles.askInput}
          type="text"
          aria-label="Ask HLNΛ about your operation"
          value={question}
          onChange={(e) =>
            setQuestion(e.target.value)
          }
          placeholder="Ask HLNΛ about your operation…"
          disabled={asking}
        />

        <button
          type="submit"
          {...buttonProps('primary', 'sm')}
          className={`${buttonProps('primary', 'sm').className} ${styles.askButton}`}
          disabled={!question.trim() || asking}
        >
          {asking ? (
            <>
              <span className={styles.thinkingDot} aria-hidden="true" />
              Thinking
            </>
          ) : (
            <>
              Ask
              <span aria-hidden="true">→</span>
            </>
          )}
        </button>
      </form>
    </section>
  )
}
