'use client';
import { useActionState, type ReactNode } from 'react';
import { Button } from '@/components/ui/app';

type Result = { message: string; ok: boolean };
type Action = (previous: Result, form: FormData) => Promise<Result>;
export default function ClassForm({
  action,
  label,
  children,
  once = false,
}: {
  action: Action;
  label: string;
  children: ReactNode;
  once?: boolean;
}) {
  const [state, submit, pending] = useActionState(action, { message: '', ok: false });
  return (
    <form action={submit}>
      <fieldset disabled={pending || (once && state.ok)}>
        {children}
        <Button type="submit">{pending ? 'Saving…' : label}</Button>
      </fieldset>
      {state.message && <p role={state.ok ? 'status' : 'alert'}>{state.message}</p>}
    </form>
  );
}
