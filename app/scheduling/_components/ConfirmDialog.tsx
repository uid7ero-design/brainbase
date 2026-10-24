'use client';
import { useState, type ReactNode } from 'react';
import { Button, Dialog, FormActions } from '@/components/ui/app';
import type { ApiProblem, ApiResult } from '@/lib/scheduling/dashboard/api';
import { ProblemNotice } from './parts';
import styles from './scheduling.module.css';

// One confirmation dialog for every irreversible or consequential action (archive, deactivate, remove). It states what will
// and will not happen, runs the action once, and on a refusal shows the reason and leaves the record exactly as it was.

export function ConfirmDialog<T>({
  title,
  confirmLabel,
  busyLabel,
  danger,
  children,
  run,
  onClose,
  onDone,
  onReload,
}: {
  title: string;
  confirmLabel: string;
  busyLabel: string;
  danger?: boolean;
  children: ReactNode;
  run: () => Promise<ApiResult<T>>;
  onClose: () => void;
  onDone: (data: T) => void;
  onReload?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<ApiProblem | null>(null);

  async function confirm() {
    setBusy(true);
    setProblem(null);
    const result = await run();
    setBusy(false);
    if (!result.ok) {
      setProblem(result.problem);
      return;
    }
    onDone(result.data);
  }

  return (
    <Dialog open onClose={onClose} title={title} width={480}>
      <div className={styles.form}>
        {children}
        {problem && <ProblemNotice problem={problem} onReload={onReload} />}
        <FormActions>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={confirm} disabled={busy} aria-busy={busy || undefined}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </FormActions>
      </div>
    </Dialog>
  );
}
