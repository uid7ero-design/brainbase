'use server';

import { revalidatePath } from 'next/cache';
import { isLocalDate } from '@scheduling/core';
import { squadSession } from './coachSquads';
import { createSchedulingExecutor } from './runtime';

type Result = { ok: boolean; message: string };
export async function changeSquad(org: string, _previous: Result, form: FormData): Promise<Result> {
  const fail = (message: string) => ({ ok: false, message });
  const session = await squadSession();
  if (!session || session.organisationId !== org) return fail('Reopen Coach with squad management access.');
  const actor = session.userId;
  const db = createSchedulingExecutor();
  const field = (key: string) => String(form.get(key) ?? '').trim();
  const name = field('name');
  const squad = field('squad');
  const day = field('day');
  try {
    switch (field('action')) {
      case 'create':
        if (!name || name.length > 120) return fail('Enter a squad name of up to 120 characters.');
        await db.query('INSERT INTO scheduling_coach_squads(organisation_id,name) VALUES($1,$2)', [
          org,
          name,
        ]);
        break;
      case 'join': {
        const email = field('email').toLowerCase();
        if (
          !name ||
          name.length > 200 ||
          !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          email.length > 320 ||
          !isLocalDate(day)
        )
          return fail('Enter the player name, email and joining date.');
        await db.query('SELECT coach_add_squad_member($1,$2,$3,$4,$5,$6)', [
          org,
          squad,
          actor,
          name,
          email,
          day,
        ]);
        break;
      }
      case 'assign': {
        const [offering, term, fee, currency] = JSON.parse(field('term'));
        if (!Number.isSafeInteger(fee) || fee < 0) return fail('Select a training term.');
        await db.query('SELECT coach_assign_squad_term($1,$2,$3,$4,$5,$6,$7)', [
          org,
          squad,
          actor,
          offering,
          term,
          fee,
          currency,
        ]);
        break;
      }
      case 'leave':
        if (!isLocalDate(day)) return fail('Enter the first day outside this squad.');
        await db.query('SELECT coach_leave_squad($1,$2,$3,$4,$5,$6)', [
          org,
          squad,
          actor,
          field('member'),
          day,
          field('destination') || null,
        ]);
        break;
      default:
        return fail('Choose a squad action.');
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'CSHIS')
      return fail(
        'This change would affect a past, marked or paid booking. Review the roster and effective date.',
      );
    if (['SCCAP', 'CS409', '23505', 'CS404', 'SCCLS', 'SCARC'].includes(code ?? ''))
      return fail(
        'Change declined. Check available places, existing bookings, squad names and membership dates. No changes were saved.',
      );
    return fail('Refresh and check the squad and training rosters before trying again.');
  }
  revalidatePath('/coaching/squads');
  revalidatePath('/coaching/calendar');
  revalidatePath('/coaching/roster/[id]', 'page');
  return { ok: true, message: 'Saved.' };
}
