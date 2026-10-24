import { PRESETS, type PresetKey } from '@scheduling/core';

// An in-memory stand-in for /api/scheduling/** that follows the REAL contract (lib/scheduling/config/*, proven against PostgreSQL in
// scripts/tests/schedulingConfigApi2b2b.integration.test.ts): version tokens, 409 STALE_WRITE, PRESET_LOCKED, ARCHIVED,
// RESOURCE_IN_USE, ALLOCATION_IN_USE, KIND_NOT_ACCEPTED, RESOURCE_INACTIVE, INVALID_INPUT. The component tests drive the real
// components through it, so they check the screens against the contract without a database. It records every request.

export interface FakeSchedule { id: string; name: string; presetKey: PresetKey; presetVersion: number; terminology: Record<string, string>; cancellationPolicy: { customerCanCancel: boolean; freeCancellationHoursBefore: number | null; lateCancellationCharge: { kind: string; percent?: number; amountCents?: number } }; timezone: string | null; publicSlug: null; updatedAt: string; archivedAt: string | null }
export interface FakeOffering { id: string; scheduleId: string; name: string; typeKey: null; colourKey: null; durationMinutes: number | null; capacity: number | null; price: { amountCents: number; currency: string }; startTime: string | null; recurrence: Record<string, unknown>; resourceKinds: string[]; updatedAt: string; archivedAt: string | null }
export interface FakeResource { id: string; kind: string; name: string; capacity: number; minParty: number | null; active: boolean; updatedAt: string }

export interface FakeRequest { method: string; path: string; body: Record<string, unknown> | null }

export class FakeSchedulingApi {
  schedules: FakeSchedule[] = [];
  offerings: FakeOffering[] = [];
  resources: FakeResource[] = [];
  links: Array<{ offeringId: string; resourceId: string }> = [];
  requests: FakeRequest[] = [];
  currency = 'AUD';
  /** Resources a live reservation holds: deactivating/unlinking them is refused, as the database would. */
  held = new Set<string>();
  /** Make the next write answer 409 STALE_WRITE, as if someone else saved first. */
  failNextWith: { status: number; body: Record<string, unknown> } | null = null;
  /** Make every request fail at the network level. */
  offline = false;
  private seq = 0;
  private tick = 0;

  private token = () => `2026-10-24T00:00:00.${String(++this.tick).padStart(6, '0')}Z`;
  private id = (p: string) => `${p}-${++this.seq}`;

  addSchedule(over: Partial<FakeSchedule> = {}): FakeSchedule {
    const presetKey = over.presetKey ?? 'classes_coaching';
    const s: FakeSchedule = {
      id: this.id('sch'), name: 'Junior coaching', presetKey, presetVersion: PRESETS[presetKey].version, terminology: {},
      cancellationPolicy: { customerCanCancel: true, freeCancellationHoursBefore: 24, lateCancellationCharge: { kind: 'none' } },
      timezone: null, publicSlug: null, updatedAt: this.token(), archivedAt: null, ...over,
    };
    this.schedules.push(s);
    return s;
  }
  addOffering(scheduleId: string, over: Partial<FakeOffering> = {}): FakeOffering {
    const o: FakeOffering = {
      id: this.id('off'), scheduleId, name: 'Tuesday juniors', typeKey: null, colourKey: null, durationMinutes: 60, capacity: 8,
      price: { amountCents: 2500, currency: this.currency }, startTime: null, recurrence: { kind: 'none' }, resourceKinds: [], updatedAt: this.token(), archivedAt: null, ...over,
    };
    this.offerings.push(o);
    return o;
  }
  addResource(over: Partial<FakeResource> = {}): FakeResource {
    const r: FakeResource = { id: this.id('res'), kind: 'court', name: 'Court 1', capacity: 4, minParty: null, active: true, updatedAt: this.token(), ...over };
    this.resources.push(r);
    return r;
  }
  link(offeringId: string, resourceId: string) {
    this.links.push({ offeringId, resourceId });
    this.syncKinds(offeringId);
  }
  private syncKinds(offeringId: string) {
    const o = this.offerings.find(x => x.id === offeringId);
    if (!o) return;
    o.resourceKinds = [...new Set(this.links.filter(l => l.offeringId === offeringId).map(l => this.resources.find(r => r.id === l.resourceId)!.kind))].sort();
  }

  writes() {
    return this.requests.filter(r => r.method !== 'GET');
  }

  /** The function to install as `fetch`. */
  handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url, 'http://app.test');
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    const path = url.pathname.replace(/^\/api\/scheduling/, '') || '/';
    this.requests.push({ method, path, body });
    if (this.offline) throw new TypeError('Failed to fetch');
    if (method !== 'GET' && this.failNextWith) {
      const f = this.failNextWith;
      this.failNextWith = null;
      return Response.json(f.body, { status: f.status });
    }
    return this.route(method, path, body);
  };

  private bad = (...problems: string[]) => Response.json({ error: 'The request is not valid.', code: 'INVALID_INPUT', problems }, { status: 400 });
  private conflict = (code: string, error = code) => Response.json({ error, code }, { status: 409 });
  private missing = () => Response.json({ error: 'Not found.', code: 'NOT_FOUND' }, { status: 404 });

  private route(method: string, path: string, body: Record<string, unknown> | null): Response {
    const m = (re: RegExp) => path.match(re);
    let g: RegExpMatchArray | null;

    if (method === 'GET' && path === '/status') return Response.json({ configured: true, timezone: 'Australia/Perth', timezone_source: 'organisation', currency: this.currency, access: { scope: 'full', permissions: [] } });

    if (path === '/schedules' && method === 'GET') return Response.json({ schedules: this.schedules });
    if (path === '/schedules' && method === 'POST') {
      const b = body ?? {};
      if (!['classes_coaching', 'appointments', 'resource_hire'].includes(String(b.presetKey))) return this.bad('presetKey must be one of: classes_coaching, appointments, resource_hire');
      if (typeof b.name !== 'string' || b.name.trim() === '') return this.bad('schedule name is required');
      const s = this.addSchedule({ name: b.name.trim(), presetKey: b.presetKey as PresetKey, timezone: (b.timezone as string | undefined) ?? null, ...(b.cancellationPolicy ? { cancellationPolicy: b.cancellationPolicy as FakeSchedule['cancellationPolicy'] } : {}) });
      return Response.json({ schedule: s }, { status: 201 });
    }
    if ((g = m(/^\/schedules\/([^/]+)$/))) {
      const s = this.schedules.find(x => x.id === decodeURIComponent(g![1]));
      if (!s) return this.missing();
      if (method === 'GET') return Response.json({ schedule: s, offerings: this.offerings.filter(o => o.scheduleId === s.id) });
      if (method === 'PATCH') {
        const { expectedUpdatedAt, ...changes } = body ?? {};
        if (Object.keys(changes).length === 0) return this.bad('nothing to change');
        if (s.archivedAt) return this.conflict('ARCHIVED');
        if (expectedUpdatedAt !== s.updatedAt) return this.conflict('STALE_WRITE');
        if (changes.presetKey && changes.presetKey !== s.presetKey && this.offerings.some(o => o.scheduleId === s.id)) return this.conflict('PRESET_LOCKED');
        Object.assign(s, changes, { updatedAt: this.token() });
        return Response.json({ schedule: s });
      }
    }
    if ((g = m(/^\/schedules\/([^/]+)\/archive$/)) && method === 'POST') {
      const s = this.schedules.find(x => x.id === decodeURIComponent(g![1]));
      if (!s) return this.missing();
      if (s.archivedAt) return this.conflict('ARCHIVED');
      s.archivedAt = '2026-10-24T01:00:00.000000Z';
      s.updatedAt = this.token();
      return Response.json({ archived: true });
    }
    if ((g = m(/^\/schedules\/([^/]+)\/offerings$/)) && method === 'POST') {
      const s = this.schedules.find(x => x.id === decodeURIComponent(g![1]));
      if (!s) return this.missing();
      if (s.archivedAt) return this.conflict('ARCHIVED');
      const b = body ?? {};
      if (typeof b.name !== 'string' || b.name.trim() === '') return this.bad('name is required');
      const o = this.addOffering(s.id, {
        name: b.name.trim(), durationMinutes: (b.durationMinutes as number | undefined) ?? null, capacity: (b.capacity as number | undefined) ?? null,
        price: { amountCents: (b.priceCents as number | undefined) ?? 0, currency: this.currency }, startTime: (b.startTime as string | undefined) ?? null,
        recurrence: (b.recurrence as Record<string, unknown> | undefined) ?? { kind: 'none' },
      });
      s.updatedAt = this.token();
      return Response.json({ offering: o }, { status: 201 });
    }
    if ((g = m(/^\/offerings\/([^/]+)$/))) {
      const o = this.offerings.find(x => x.id === decodeURIComponent(g![1]));
      if (!o) return this.missing();
      if (method === 'GET') return Response.json({ offering: o, resources: this.links.filter(l => l.offeringId === o.id).map(l => this.resources.find(r => r.id === l.resourceId)) });
      if (method === 'PATCH') {
        const { expectedUpdatedAt, ...c } = body ?? {};
        if (o.archivedAt) return this.conflict('ARCHIVED');
        if (expectedUpdatedAt !== o.updatedAt) return this.conflict('STALE_WRITE');
        if ('priceCents' in c) {
          o.price = { amountCents: c.priceCents as number, currency: o.price.currency };
          delete c.priceCents;
        }
        Object.assign(o, c, { updatedAt: this.token() });
        return Response.json({ offering: o });
      }
    }
    if ((g = m(/^\/offerings\/([^/]+)\/archive$/)) && method === 'POST') {
      const o = this.offerings.find(x => x.id === decodeURIComponent(g![1]));
      if (!o) return this.missing();
      if (o.archivedAt) return this.conflict('ARCHIVED');
      o.archivedAt = '2026-10-24T01:00:00.000000Z';
      return Response.json({ archived: true });
    }
    if ((g = m(/^\/offerings\/([^/]+)\/resources$/))) {
      const o = this.offerings.find(x => x.id === decodeURIComponent(g![1]));
      if (!o) return this.missing();
      if (method === 'GET') return Response.json({ resources: this.links.filter(l => l.offeringId === o.id).map(l => this.resources.find(r => r.id === l.resourceId)) });
      if (method === 'POST') {
        const r = this.resources.find(x => x.id === body?.resourceId);
        if (!r) return this.missing();
        const sched = this.schedules.find(s => s.id === o.scheduleId)!;
        if (!r.active) return this.conflict('RESOURCE_INACTIVE');
        if (!(PRESETS[sched.presetKey].resources.kinds as readonly string[]).includes(r.kind)) return Response.json({ error: 'kind', code: 'KIND_NOT_ACCEPTED', accepted: PRESETS[sched.presetKey].resources.kinds }, { status: 409 });
        const already = this.links.some(l => l.offeringId === o.id && l.resourceId === r.id);
        if (!already) this.link(o.id, r.id);
        return Response.json({ linked: true, changed: !already }, { status: already ? 200 : 201 });
      }
    }
    if ((g = m(/^\/offerings\/([^/]+)\/resources\/([^/]+)$/)) && method === 'DELETE') {
      const oid = decodeURIComponent(g[1]);
      const rid = decodeURIComponent(g[2]);
      if (this.held.has(rid)) return this.conflict('ALLOCATION_IN_USE');
      const had = this.links.some(l => l.offeringId === oid && l.resourceId === rid);
      this.links = this.links.filter(l => !(l.offeringId === oid && l.resourceId === rid));
      this.syncKinds(oid);
      return Response.json({ removed: had });
    }

    if (path === '/resources' && method === 'GET') return Response.json({ resources: this.resources });
    if (path === '/resources' && method === 'POST') {
      const b = body ?? {};
      if (typeof b.name !== 'string' || b.name.trim() === '') return this.bad('name is required');
      const r = this.addResource({ name: b.name.trim(), kind: String(b.kind), capacity: Number(b.capacity), minParty: (b.minParty as number | undefined) ?? null });
      return Response.json({ resource: r }, { status: 201 });
    }
    if ((g = m(/^\/resources\/([^/]+)$/))) {
      const r = this.resources.find(x => x.id === decodeURIComponent(g![1]));
      if (!r) return this.missing();
      if (method === 'GET') return Response.json({ resource: r });
      if (method === 'PATCH') {
        const { expectedUpdatedAt, ...c } = body ?? {};
        if (expectedUpdatedAt !== r.updatedAt) return this.conflict('STALE_WRITE');
        if ('kind' in c && c.kind !== r.kind && (this.held.has(r.id) || this.links.some(l => l.resourceId === r.id))) return this.conflict('RESOURCE_IN_USE');
        Object.assign(r, c, { updatedAt: this.token() });
        return Response.json({ resource: r });
      }
    }
    if ((g = m(/^\/resources\/([^/]+)\/(deactivate|reactivate)$/)) && method === 'POST') {
      const r = this.resources.find(x => x.id === decodeURIComponent(g![1]));
      if (!r) return this.missing();
      if (body?.expectedUpdatedAt !== r.updatedAt) return this.conflict('STALE_WRITE');
      if (g[2] === 'deactivate' && this.held.has(r.id)) return this.conflict('RESOURCE_IN_USE');
      r.active = g[2] === 'reactivate';
      r.updatedAt = this.token();
      return Response.json({ resource: r });
    }
    return Response.json({ error: `unhandled ${method} ${path}`, code: 'ERROR' }, { status: 500 });
  }
}
