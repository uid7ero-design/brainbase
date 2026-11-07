import { schedulingApi, seg, type ApiProblem, type ApiResult } from '@/lib/scheduling/dashboard/api';

// Phase 2C.3c UI slice 1: the client side of GET /api/scheduling/reservations/basis (and the reads that find what can be booked).
// Pure of server imports. READ ONLY: nothing in this file can create, change or cancel a booking.
//
// Wording is FIXED per refusal code (never server text), as the design requires. Nothing here echoes a value.

export interface BasisView {
  basis: { offeringVersion: string; resourceVersion: string; offeringToken: string; scheduleToken: string };
  offering: { id: string; durationMinutes: number; price: { amountCents: number; currency: string } | null };
  resource: { id: string; capacity: number };
  timezone: string;
  range: { from: string; to: string };
  generatedAt: string;
  days: Array<{ date: string; starts: Array<{ time: string; startsAt: string }> }>;
}

export const WINDOW_DAYS = 14;

export function fetchBasis(q: { offeringId: string; resourceId: string; from: string; to: string }, signal?: AbortSignal): Promise<ApiResult<BasisView>> {
  const query = new URLSearchParams({ offeringId: q.offeringId, resourceId: q.resourceId, from: q.from, to: q.to });
  return schedulingApi<BasisView>('GET', `/reservations/basis?${query.toString()}`, undefined, signal);
}

export interface BookableOffering {
  id: string;
  name: string;
  durationMinutes: number;
  price: { amountCents: number; currency: string };
}

interface ScheduleRow { id: string; presetKey: string; archivedAt: string | null }
interface OfferingRow { id: string; name: string; durationMinutes: number | null; price: { amountCents: number; currency: string }; archivedAt: string | null }
interface ResourceRow { id: string; active: boolean }

/** A safety bound on the discovery fan-out: a larger configuration is cut at this many facility-hire offerings (the list says so). */
export const MAX_OFFERINGS_CHECKED = 40;

/**
 * The facility-hire offerings that currently link THIS resource (active), found with the existing configuration reads
 * (schedules, their offerings, each offering's resources). No new endpoint. The basis endpoint stays the authority: a
 * result here only decides what the dialog offers to choose from.
 */
export async function loadBookableOfferings(resourceId: string, signal?: AbortSignal): Promise<ApiResult<{ offerings: BookableOffering[]; truncated: boolean }>> {
  const schedules = await schedulingApi<{ schedules: ScheduleRow[] }>('GET', '/schedules', undefined, signal);
  if (!schedules.ok) return schedules;
  const hire = schedules.data.schedules.filter(s => s.presetKey === 'resource_hire' && s.archivedAt === null);

  const lists = await Promise.all(hire.map(s => schedulingApi<{ offerings: OfferingRow[] }>('GET', `/schedules/${seg(s.id)}/offerings`, undefined, signal)));
  for (const list of lists) if (!list.ok) return list;
  const candidates = lists.flatMap(l => (l.ok ? l.data.offerings : [])).filter(o => o.archivedAt === null && typeof o.durationMinutes === 'number' && o.durationMinutes > 0);
  const checked = candidates.slice(0, MAX_OFFERINGS_CHECKED);

  const links = await Promise.all(checked.map(o => schedulingApi<{ resources: ResourceRow[] }>('GET', `/offerings/${seg(o.id)}/resources`, undefined, signal)));
  for (const link of links) if (!link.ok) return link;
  const offerings: BookableOffering[] = [];
  checked.forEach((o, i) => {
    const l = links[i];
    if (l.ok && l.data.resources.some(r => r.id === resourceId && r.active)) offerings.push({ id: o.id, name: o.name, durationMinutes: o.durationMinutes as number, price: o.price });
  });
  offerings.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, data: { offerings, truncated: candidates.length > checked.length } };
}

/** What the dialog shows for a failed read. `gateOff`: a gate closed under the user (404 without a code): close and hide the button. */
export interface ReadFailure {
  text: string;
  gateOff: boolean;
  retryable: boolean;
}

const CODE_TEXT: Record<string, string> = {
  NOT_FOUND: 'This resource or offering no longer exists, or you do not have access to it.',
  OFFERING_NOT_BOOKABLE: 'This offering cannot be booked by staff.',
  OFFERING_UNAVAILABLE: 'This offering is archived, so it cannot be booked.',
  RESOURCE_NOT_ELIGIBLE: 'This resource is not assigned to that offering.',
  RESOURCE_INACTIVE: 'This resource is inactive, so it cannot be booked.',
  DURATION_NOT_ALLOWED: 'This offering’s length cannot be booked here.',
  RANGE_TOO_LARGE: 'That range holds too many times to show. Pick a shorter range.',
  AVAILABILITY_UNREADABLE: 'The hours for this resource cannot be read, so no times can be offered. Check its hours.',
  BOOKING_NOT_READY: 'Booking is not available right now.',
};

export function describeReadFailure(problem: ApiProblem): ReadFailure {
  if (problem.status === 404 && problem.code !== 'NOT_FOUND') return { text: 'Booking is not available.', gateOff: true, retryable: false };
  if (problem.status === 401) return { text: 'Your session has ended. Sign in again to continue.', gateOff: false, retryable: false };
  if (problem.status === 403) return { text: 'You do not have permission to book here.', gateOff: false, retryable: false };
  if (CODE_TEXT[problem.code]) return { text: CODE_TEXT[problem.code], gateOff: false, retryable: false };
  return { text: 'The available times could not be loaded. Nothing was booked.', gateOff: false, retryable: true };
}
