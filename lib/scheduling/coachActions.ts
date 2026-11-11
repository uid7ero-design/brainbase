'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { authorizeSchedulingRequest } from './access';
import { addClassDate } from './coachClassDates';
import {
  trainingSession,
  persistTrainingPlan,
  changePublication,
  coachLinkPattern,
  groupTennisTerm,
  enrolClass,
  enrolTerm,
  updateMember,
} from './coachClasses';
import { decodePlan, templateDrills } from './trainingPlan';
import { checkRateLimit } from '@/lib/rateLimit';

type Result = { message: string; ok: boolean };
const result = (message: string, ok = false): Result => ({ message, ok });
const uncertain = () =>
  result('The change could not be confirmed. Refresh and check the saved class before trying again.');
const field = (form: FormData, name: string) => String(form.get(name) ?? '').trim();
export async function manageClass(org: string, _previous: Result, form: FormData): Promise<Result> {
  const action = field(form, 'action');
  const permission =
    action === 'cancel' || action === 'enrol'
      ? 'scheduling.reserve'
      : action === 'attended' || action === 'absent'
        ? 'scheduling.attendance'
        : 'scheduling.manage';
  const auth = await authorizeSchedulingRequest(
    permission,
    action === 'enrol' ? { feature: 'staff_booking' } : {},
  );
  if (!auth.ok || auth.session.organisationId !== org)
    return result('Reopen Coach in an authorised workspace.');
  try {
    let ok = false;
    switch (action) {
      case 'group-tennis-term':
        ok = await groupTennisTerm(
          org,
          auth.session.userId,
          field(form, 'class'),
          field(form, 'termName'),
          JSON.parse(field(form, 'expectedDates')),
        );
        if (!ok)
          return result('The class dates have changed or already belong to a term. Refresh the roster.');
        break;
      case 'term':
      case 'date': {
        const [offering, resource] = JSON.parse(field(form, 'offering'));
        if (typeof offering !== 'string' || (resource !== null && typeof resource !== 'string'))
          return result('Choose a class.');
        ok = await addClassDate(
          auth.session,
          offering,
          resource,
          field(form, 'day'),
          field(form, 'time'),
          action === 'term' ? { name: field(form, 'termName'), end: field(form, 'end') } : undefined,
        );
        if (action === 'term' && !ok)
          return result(
            'Check the class, term name, dates and local start time. A term must cover 2 to 26 weekly classes at an unambiguous local time.',
          );
        break;
      }
      case 'publish':
      case 'unpublish': {
        const old = action === 'publish' ? null : field(form, 'slug');
        ok = (await changePublication(org, field(form, 'schedule'), old)).length > 0;
        break;
      }
      case 'enrol':
        return submitBooking(org, { staff: auth.session.userId }, form);
      case 'cancel':
      case 'attended':
      case 'absent':
        ok =
          (
            await updateMember(
              org,
              field(form, 'class'),
              field(form, 'member'),
              field(form, 'version'),
              action,
            )
          ).length > 0;
        break;
      default:
        return result('Unknown class action.');
    }
    revalidatePath('/coaching/calendar');
    revalidatePath('/coaching/roster/[id]', 'page');
    return ok
      ? result('Saved.', true)
      : result('The class or booking is unavailable or has changed. Review the current details.');
  } catch (error) {
    if (action === 'term' && ['23505', '23P01', 'SCARC', 'SCLNK'].includes((error as { code: string }).code))
      return result(
        'One or more dates conflict with the saved schedule. Review the calendar before trying again.',
      );
    return uncertain();
  }
}
async function submitBooking(org: string, scope: { staff: string } | { link: string }, form: FormData) {
  const id = field(form, 'class'),
    key = field(form, 'key'),
    name = field(form, 'name'),
    email = field(form, 'email').toLowerCase();
  const [amount, currency] = field(form, 'price').split('/');
  if (
    !/^[a-zA-Z0-9_-]{1,128}$/.test(id) ||
    !/^[0-9a-f-]{36}$/i.test(key) ||
    !name ||
    name.length > 200 ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    !/^\d+$/.test(amount) ||
    !/^[A-Z]{3}$/.test(currency)
  )
    return result('Enter a name and valid email and select a class.');
  try {
    const input = { id, key, name, email, cents: Number(amount), currency };
    if ('staff' in scope && field(form, 'coverage') === 'term') {
      const dates: unknown = JSON.parse(field(form, 'expectedDates'));
      if (!Array.isArray(dates) || !dates.every((d) => typeof d === 'string'))
        return result('Refresh the roster to review the term dates.');
      const ok = await enrolTerm(org, scope.staff, input, dates);
      revalidatePath('/coaching/calendar');
      revalidatePath('/coaching/roster/[id]', 'page');
      return ok
        ? result('Term enrolment confirmed.', true)
        : result(
            'Term booking unavailable. Review capacity, existing enrolments, dates and price. No new places were booked.',
          );
    }
    const ok = await enrolClass(org, scope, input);
    if ('staff' in scope) revalidatePath('/coaching/roster/[id]', 'page');
    return ok
      ? result('Booking confirmed.', true)
      : result('Booking unavailable. Check the current price, places and any previous enrolment.');
  } catch {
    return uncertain();
  }
}
export async function bookPublicClass(
  org: string,
  link: string,
  _previous: Result,
  form: FormData,
): Promise<Result> {
  if (!coachLinkPattern.test(link)) return result('Booking unavailable.');
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
  if (!checkRateLimit('public-coach:' + ip, 20, 60 * 60_000))
    return result('Too many requests. Try again later.');
  return submitBooking(org, { link }, form);
}

export async function saveTrainingPlan(
  org: string,
  id: string,
  version: number,
  input: unknown,
  template: string,
) {
  const [manage, roster] = await Promise.all([
    authorizeSchedulingRequest('scheduling.manage'),
    authorizeSchedulingRequest('scheduling.reserve'),
  ]);
  if (
    !manage.ok ||
    !roster.ok ||
    manage.session.organisationId !== org ||
    roster.session.organisationId !== org ||
    manage.session.userId !== roster.session.userId
  )
    return { error: 'Reopen the plan in an authorised workspace.', recovery: true };
  if (!Number.isSafeInteger(version) || version < 0 || typeof template !== 'string' || template.length > 100)
    return { error: 'Review the template name and reload the saved plan.' };
  try {
    const session = await trainingSession(org, id);
    if (!session?.editable || session.version !== version)
      return { error: 'The session changed. Reload the saved plan before editing.', recovery: true };
    let drills;
    try {
      drills = decodePlan(input, new Set(session.players.map((p) => p.id)));
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Review the drills.' };
    }
    const saved = await persistTrainingPlan(
      org,
      id,
      version,
      drills,
      template.trim(),
      templateDrills(drills),
    );
    if (!saved) return { error: 'The session changed. Reload the saved plan before editing.', recovery: true };
    revalidatePath('/coaching/roster/[id]/plan', 'page');
    return { version: saved };
  } catch (error) {
    if ((error as { code?: string }).code === '23505')
      return { error: 'A template already has that name. Choose another name.' };
    return { error: 'Save could not be confirmed. Reload and check the saved plan before retrying.', recovery: true };
  }
}
