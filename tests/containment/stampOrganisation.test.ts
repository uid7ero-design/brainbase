import { describe, it, expect } from 'vitest';
import { stampOrganisationOnObject, stampOrganisationOnFormData } from '@/lib/stampOrganisation';

describe('stampOrganisation.stampOrganisationOnObject', () => {
  it('overwrites a malicious client-supplied organisationId with the authenticated value', () => {
    const spoofed = { organisationId: 'attacker-org', query: 'hello' };
    const stamped = stampOrganisationOnObject(spoofed, 'real-org');
    expect(stamped.organisationId).toBe('real-org');
    expect(stamped.organisation_id).toBe('real-org');
    expect(stamped.query).toBe('hello');
  });

  it('strips every known alias before restamping', () => {
    const spoofed = { organisationId: 'a', organisation_id: 'b', orgId: 'c', org_id: 'd' };
    const stamped = stampOrganisationOnObject(spoofed, 'real-org');
    expect(stamped.organisationId).toBe('real-org');
    expect(stamped.organisation_id).toBe('real-org');
    expect((stamped as Record<string, unknown>).orgId).toBeUndefined();
    expect((stamped as Record<string, unknown>).org_id).toBeUndefined();
  });

  it('sets the org id even when the client supplied none at all', () => {
    const stamped = stampOrganisationOnObject({ query: 'x' }, 'real-org');
    expect(stamped.organisationId).toBe('real-org');
    expect(stamped.organisation_id).toBe('real-org');
  });
});

describe('stampOrganisation.stampOrganisationOnFormData', () => {
  it('overwrites a malicious client-supplied organisationId field on FormData', () => {
    const fd = new FormData();
    fd.set('organisationId', 'attacker-org');
    fd.set('query', 'hello');
    stampOrganisationOnFormData(fd, 'real-org');
    expect(fd.get('organisationId')).toBe('real-org');
    expect(fd.get('organisation_id')).toBe('real-org');
    expect(fd.get('query')).toBe('hello');
  });
});
