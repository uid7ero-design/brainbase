'use server';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { authorizeSchedulingRequest } from './access';
import { addClassDate } from './coachClassDates';
import { changePublication, coachLinkPattern, enrolClass, updateMember } from './coachClasses';
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
      case 'date': {
        const [offering, resource] = JSON.parse(field(form, 'offering'));
        if (typeof offering !== 'string' || (resource !== null && typeof resource !== 'string'))
          return result('Choose a class.');
        ok = await addClassDate(auth.session, offering, resource, field(form, 'day'), field(form, 'time'));
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
  } catch {
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
    const ok = await enrolClass(org, scope, { id, key, name, email, cents: Number(amount), currency });
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
