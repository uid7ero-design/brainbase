'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/app/Button';

export default function PersonAiAssistant({ personId }: { personId: string }) {
  const id = useId();
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => { request.current?.abort(); }, []);

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (request.current || !question.trim() || question.trim().length > 2_000) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setAnswer('');
    setError('');
    try {
      const response = await fetch('/api/hr/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ person_id: personId, question: question.trim() }),
        signal: controller.signal,
        cache: 'no-store',
      });
      const data: unknown = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok) {
        setError(response.status === 429
          ? 'Request limit reached. Please try again later.'
          : 'HR assistant is temporarily unavailable. Please try again.');
        return;
      }
      if (!data || typeof data !== 'object' || !('answer' in data)
        || typeof data.answer !== 'string' || !data.answer.trim() || data.answer.length > 6_000) {
        setError('HR assistant is temporarily unavailable. Please try again.');
        return;
      }
      setAnswer(data.answer);
    } catch {
      if (!controller.signal.aborted) setError('HR assistant is temporarily unavailable. Please try again.');
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setPending(false);
      }
    }
  }

  return (
    <section aria-labelledby={`${id}-heading`} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 14 }}>
      <h3 id={`${id}-heading`} style={{ fontSize: 14, margin: '0 0 8px' }}>HR assistant</h3>
      <p id={`${id}-help`} style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        Ask about this person’s role or visible lifecycle progress. Answers use limited HR context and may be incorrect. Check the records before acting.
      </p>
      <form onSubmit={ask} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label htmlFor={`${id}-question`}>Question</label>
        <textarea
          id={`${id}-question`}
          aria-describedby={`${id}-help`}
          value={question}
          onChange={event => setQuestion(event.target.value)}
          maxLength={2_000}
          rows={3}
          disabled={pending}
          style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
        />
        <Button type="submit" disabled={pending || !question.trim()}>
          {pending ? 'Asking…' : 'Ask HR assistant'}
        </Button>
      </form>
      <div aria-live="polite" aria-busy={pending}>
        {error && <p role="alert">{error}</p>}
        {answer && <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{answer}</p>}
      </div>
    </section>
  );
}
