// Every alias a client (or a compromised/naive caller) might use to try to
// select which tenant's data an external backend call operates on. All of
// them are stripped before the authenticated server-side value is stamped
// back in — the client must never be able to choose or override the tenant
// sent to an external service.
const ORG_ID_KEYS = ['organisationId', 'organisation_id', 'orgId', 'org_id'];

type WithOrganisation<T> = Omit<T, 'organisationId' | 'organisation_id' | 'orgId' | 'org_id'> & {
  organisationId: string;
  organisation_id: string;
};

export function stampOrganisationOnObject<T extends Record<string, unknown>>(
  body: T,
  organisationId: string,
): WithOrganisation<T> {
  const next = { ...body } as Record<string, unknown>;
  for (const key of ORG_ID_KEYS) delete next[key];
  next.organisationId = organisationId;
  next.organisation_id = organisationId;
  return next as WithOrganisation<T>;
}

export function stampOrganisationOnFormData(formData: FormData, organisationId: string): void {
  for (const key of ORG_ID_KEYS) formData.delete(key);
  formData.set('organisationId', organisationId);
  formData.set('organisation_id', organisationId);
}
