/** Browser-safe command vocabulary. Tenant and actor are never request fields. */
export type CoachingAction =
  | { kind: 'enrol'; idempotencyKey: string; occurrenceId: string; name: string; email: string | null; phone: string | null; notes: string | null; weekly: boolean; until: string }
  | { kind: 'attendance'; idempotencyKey: string; bookingId: string; value: 'attended' | 'absent' | null; expectedVersion: number }
  | { kind: 'paid-marker'; idempotencyKey: string; bookingId: string; paid: boolean; expectedVersion: number }
  | { kind: 'cancel'; idempotencyKey: string; bookingId: string }
  | { kind: 'start-weekly'; idempotencyKey: string; bookingId: string; from: string; until: string }
  | { kind: 'stop-weekly'; idempotencyKey: string; seriesId: string; after: string }
  | { kind: 'pause'; idempotencyKey: string; seriesId: string; from: string; until: string; reason: string | null }
  | { kind: 'resume'; idempotencyKey: string; seriesId: string; pauseId: string; from: string; until: string };

export function parseCoachingAction(value: Record<string, unknown>): CoachingAction | null {
  const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
  const version = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;
  const date = (v:unknown):v is string => typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v;
  if (typeof value.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(value.idempotencyKey)) return null;
  const fields: Record<string, string[]> = {
    enrol: ['occurrenceId','name','email','phone','notes','weekly','until'], attendance: ['bookingId','value','expectedVersion'],
    'paid-marker': ['bookingId','paid','expectedVersion'], cancel: ['bookingId'],
    'start-weekly':['bookingId','from','until'],'stop-weekly':['seriesId','after'],pause:['seriesId','from','until','reason'],resume:['seriesId','pauseId','from','until'],
  };
  if (typeof value.kind !== 'string' || !Object.hasOwn(fields,value.kind)
    || Object.keys(value).some(k=>!['kind','idempotencyKey',...fields[value.kind as string]].includes(k))) return null;
  if (value.kind === 'enrol') {
    if (!id(value.occurrenceId) || typeof value.name !== 'string' || !value.name.trim() || value.name.length>200
      || (value.email!==null && (typeof value.email!=='string' || value.email.length>320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())))
      || (value.phone!==null && (typeof value.phone!=='string' || value.phone.length>80))
      || (value.notes!==null && (typeof value.notes!=='string' || value.notes.length>4000))
      || typeof value.weekly!=='boolean' || !date(value.until)) return null;
  } else if (['pause','resume','stop-weekly'].includes(value.kind) ? !id(value.seriesId) : !id(value.bookingId)) return null;
  else if (value.kind==='attendance' && (![null,'attended','absent'].includes(value.value as null) || !version(value.expectedVersion))) return null;
  else if (value.kind==='paid-marker' && (typeof value.paid!=='boolean' || !version(value.expectedVersion))) return null;
  if(['pause','resume','start-weekly'].includes(value.kind)) {
    if(!date(value.from) || !date(value.until) || value.until<value.from || Date.parse(value.until)-Date.parse(value.from)>(value.kind==='pause' ? 366 : 70)*86400000)return null;
  }
  if(value.kind==='stop-weekly' && !date(value.after))return null;
  if(value.kind==='resume' && !id(value.pauseId))return null;
  if(value.kind==='pause' && value.reason!==null && (typeof value.reason!=='string' || value.reason.length>1000))return null;
  return value as CoachingAction;
}
