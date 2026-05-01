'use client'

import { useEffect, useState, useRef } from 'react'

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

type Briefing = {
  greeting:    string
  lines:       string[]
  urgentCount: number
  summary:     string
  hasData:     boolean
}

// WHAT CHANGED / WHY / RISK / ACTION
const LINE_LABELS = [
  { label: 'Situation', color: '#60a5fa' },
  { label: 'Context',   color: 'rgba(255,255,255,.40)' },
  { label: 'Risk',      color: '#fbbf24' },
  { label: 'Action',    color: '#4ade80' },
]

function LoadingPulse() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '20px 20px 16px' }}>
      {[80, 100, 70, 90].map((w, i) => (
        <div key={i} style={{ height: 12, borderRadius: 6, width: `${w}%`, background: 'rgba(255,255,255,.06)', animation: 'pulse 1.6s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
      ))}
      <style>{`@keyframes pulse { 0%,100%{opacity:.4} 50%{opacity:.9} }`}</style>
    </div>
  )
}

export default function HlnaInsightCard() {
  const [briefing,  setBriefing]  = useState<Briefing | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [question,  setQuestion]  = useState('')
  const [answer,    setAnswer]    = useState('')
  const [asking,    setAsking]    = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/hlna/briefing', { method: 'POST' })
      .then(r => r.json())
      .then((data: Briefing) => { setBriefing(data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function handleAsk(e: { preventDefault(): void }) {
    e.preventDefault()
    const q = question.trim()
    if (!q || asking) return
    setQuestion('')
    setAsking(true)
    setAnswer('')
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: q }] }),
      })
      const data = await res.json()
      setAnswer(data.response ?? 'No response.')
    } catch {
      setAnswer('HLNA is unavailable right now.')
    }
    setAsking(false)
  }

  const urgent = briefing?.urgentCount ?? 0

  return (
    <div style={{
      background: 'rgba(99,102,241,.04)',
      border: '1px solid rgba(99,102,241,.20)',
      borderRadius: 14, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      fontFamily: FONT,
    }}>
      {/* Header */}
      <div style={{
        padding: '14px 20px',
        borderBottom: '1px solid rgba(99,102,241,.14)',
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(99,102,241,.05)',
      }}>
        <span style={{ fontSize: 14, color: '#818cf8', lineHeight: 1 }}>◈</span>
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.50)' }}>
          HLNA Insight
        </span>
        {urgent > 0 && (
          <span style={{
            marginLeft: 'auto',
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
            background: 'rgba(251,191,36,.12)', color: '#fbbf24', border: '1px solid rgba(251,191,36,.22)',
            letterSpacing: '.04em',
          }}>
            {urgent} URGENT
          </span>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, padding: '14px 18px 0' }}>
        {loading ? (
          <LoadingPulse />
        ) : !briefing?.hasData ? (
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,.30)', lineHeight: 1.6, margin: 0 }}>
            No data yet. Add contacts and leads to unlock AI insights.
          </p>
        ) : (
          <>
            {/* Summary */}
            <p style={{ fontSize: 13, fontWeight: 500, color: '#F5F7FA', margin: '0 0 12px', lineHeight: 1.5 }}>
              {briefing.summary}
            </p>

            {/* 4-part briefing lines */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
              {briefing.lines.map((line, i) => {
                const meta = LINE_LABELS[i]
                const isAction = i === 3
                return (
                  <div
                    key={i}
                    style={{
                      paddingLeft: 10,
                      borderLeft: `2px solid ${meta?.color ?? 'rgba(255,255,255,.15)'}`,
                      ...(isAction ? {
                        background: 'rgba(74,222,128,.05)',
                        borderRadius: '0 6px 6px 0',
                        padding: '7px 10px',
                        border: '1px solid rgba(74,222,128,.12)',
                        borderLeft: '2px solid #4ade80',
                      } : {}),
                    }}
                  >
                    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: meta?.color ?? 'rgba(255,255,255,.30)', marginBottom: 2 }}>
                      {meta?.label}
                    </div>
                    <div style={{ fontSize: 11, color: isAction ? '#e2e8f0' : 'rgba(255,255,255,.60)', lineHeight: 1.45 }}>
                      {line}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* Inline answer */}
        {answer && (
          <div style={{
            margin: '0 0 14px',
            padding: '10px 12px',
            background: 'rgba(129,140,248,.08)',
            border: '1px solid rgba(129,140,248,.18)',
            borderRadius: 9,
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.10em', color: '#818cf8', marginBottom: 5, textTransform: 'uppercase' }}>
              HLNA
            </div>
            <p style={{ fontSize: 12, color: 'rgba(255,255,255,.75)', lineHeight: 1.6, margin: 0 }}>
              {answer}
            </p>
          </div>
        )}
      </div>

      {/* Ask input */}
      <form
        onSubmit={handleAsk}
        style={{
          padding: '12px 14px',
          borderTop: '1px solid rgba(99,102,241,.12)',
          display: 'flex', gap: 8, alignItems: 'center',
          background: 'rgba(99,102,241,.03)',
        }}
      >
        <style>{`.hlna-ask::placeholder{color:rgba(255,255,255,.25)}`}</style>
        <input
          ref={inputRef}
          className="hlna-ask"
          type="text"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Ask HLNA…"
          disabled={asking}
          style={{
            flex: 1, background: 'transparent',
            border: 'none', outline: 'none',
            fontSize: 12, color: '#F5F7FA',
            fontFamily: FONT,
          }}
        />
        <button
          type="submit"
          disabled={!question.trim() || asking}
          style={{
            background: asking ? 'rgba(129,140,248,.15)' : 'rgba(129,140,248,.22)',
            border: '1px solid rgba(129,140,248,.28)',
            borderRadius: 7, padding: '5px 12px',
            fontSize: 11, fontWeight: 600, color: asking ? 'rgba(129,140,248,.50)' : '#a5b4fc',
            cursor: asking ? 'default' : 'pointer',
            fontFamily: FONT, letterSpacing: '.02em',
            transition: 'opacity .15s',
          }}
        >
          {asking ? '…' : 'Ask'}
        </button>
      </form>
    </div>
  )
}
