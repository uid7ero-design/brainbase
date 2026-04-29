'use client';

import { useAppStore } from '@/lib/state/useAppStore';
import { HLNA_MODULES } from '@/lib/hlna/modules';

const FONT = "var(--font-inter), -apple-system, sans-serif";

export function SuggestedQuestions() {
  const { activeModule, fireHelena, setChatOpen } = useAppStore();

  const mod = activeModule ? HLNA_MODULES[activeModule] : null;
  const questions = mod?.questions ?? [
    'Summarise today\'s performance',
    'What needs immediate attention?',
    'Show me the top cost drivers',
    'What changed since yesterday?',
  ];

  function ask(q: string) {
    fireHelena(q);
    setChatOpen(true);
  }

  return (
    <div style={{ fontFamily: FONT }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.10em', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', marginBottom: 8, textAlign: 'center' }}>
        Suggested Questions
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
        {questions.slice(0, 6).map((q, i) => (
          <button
            key={i}
            onClick={() => ask(q)}
            style={{
              padding: '5px 12px', borderRadius: 20, fontSize: 11,
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
              color: 'rgba(230,237,243,0.55)', cursor: 'pointer', fontFamily: FONT,
              transition: 'all 0.18s', letterSpacing: '-0.01em', lineHeight: 1.4,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(124,58,237,0.10)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(124,58,237,0.28)';
              (e.currentTarget as HTMLButtonElement).style.color = '#C4B5FD';
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.03)';
              (e.currentTarget as HTMLButtonElement).style.borderColor = 'rgba(255,255,255,0.08)';
              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(230,237,243,0.55)';
            }}
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
