import 'server-only';

import { createVercelBlobFileStore } from '@/lib/data-hub/storage/vercelBlobFileStore';
import { validateStorageKey, type RawFileStore } from '@/lib/data-hub/storage/rawFileStore';

export interface RestrictedHrBlobCredentials {
  storeId: string;
  token: string;
}

export class RestrictedHrDocumentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RestrictedHrDocumentConfigurationError';
  }
}

let memoizedCredentials: RestrictedHrBlobCredentials | undefined;

function resolveCredentialsFromEnv(): RestrictedHrBlobCredentials {
  const storeId = process.env.HR_RESTRICTED_BLOB_STORE_ID;
  const token = process.env.HR_RESTRICTED_BLOB_READ_WRITE_TOKEN;

  if (typeof storeId !== 'string' || storeId.trim().length === 0) {
    throw new RestrictedHrDocumentConfigurationError(
      'Restricted HR document storage is not configured: HR_RESTRICTED_BLOB_STORE_ID is missing or empty. ' +
        'This service never falls back to another Blob store.'
    );
  }
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new RestrictedHrDocumentConfigurationError(
      'Restricted HR document storage is not configured: HR_RESTRICTED_BLOB_READ_WRITE_TOKEN is missing or empty. ' +
        'This service never falls back to another Blob store.'
    );
  }
  return { storeId, token };
}

function resolveCredentials(override?: RestrictedHrBlobCredentials): RestrictedHrBlobCredentials {
  if (override) return override;
  if (memoizedCredentials) return memoizedCredentials;
  memoizedCredentials = resolveCredentialsFromEnv();
  return memoizedCredentials;
}

export function createRestrictedHrDocumentStore(
  override?: RestrictedHrBlobCredentials,
): RawFileStore {
  return createVercelBlobFileStore(resolveCredentials(override));
}

const KEY_COMPONENT_PATTERN = /^[A-Za-z0-9_-]+$/;

function validateKeyComponent(name: string, value: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
  if (!KEY_COMPONENT_PATTERN.test(value)) {
    throw new TypeError(
      `${name} may only contain ASCII letters, digits, '_', and '-'; received ${JSON.stringify(value)}.`
    );
  }
}

export function buildRestrictedHrDocumentKey(
  organisationId: string,
  caseId: string,
  documentId: string,
): string {
  validateKeyComponent('organisationId', organisationId);
  validateKeyComponent('caseId', caseId);
  validateKeyComponent('documentId', documentId);
  const key = `org_${organisationId}/hr_restricted_case_${caseId}/document_${documentId}`;
  validateStorageKey(key);
  return key;
}
