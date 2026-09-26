import 'server-only';

import { createVercelBlobFileStore } from '@/lib/data-hub/storage/vercelBlobFileStore';
import { validateStorageKey, type RawFileStore } from '@/lib/data-hub/storage/rawFileStore';

export interface EmployeeHrBlobCredentials {
  storeId: string;
  token: string;
}

export class EmployeeHrDocumentConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmployeeHrDocumentConfigurationError';
  }
}

let memoizedCredentials: EmployeeHrBlobCredentials | undefined;

function resolveCredentialsFromEnv(): EmployeeHrBlobCredentials {
  const storeId = process.env.HR_EMPLOYEE_DOC_BLOB_STORE_ID;
  const token = process.env.HR_EMPLOYEE_DOC_BLOB_READ_WRITE_TOKEN;

  if (typeof storeId !== 'string' || storeId.trim().length === 0) {
    throw new EmployeeHrDocumentConfigurationError(
      'Employee HR document storage is not configured: HR_EMPLOYEE_DOC_BLOB_STORE_ID is missing or empty. ' +
        'This service never falls back to another Blob store.',
    );
  }

  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new EmployeeHrDocumentConfigurationError(
      'Employee HR document storage is not configured: HR_EMPLOYEE_DOC_BLOB_READ_WRITE_TOKEN is missing or empty. ' +
        'This service never falls back to another Blob store.',
    );
  }

  return { storeId, token };
}

function resolveCredentials(override?: EmployeeHrBlobCredentials): EmployeeHrBlobCredentials {
  if (override) return override;
  if (memoizedCredentials) return memoizedCredentials;
  memoizedCredentials = resolveCredentialsFromEnv();
  return memoizedCredentials;
}

export function createEmployeeHrDocumentStore(
  override?: EmployeeHrBlobCredentials,
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
      `${name} may only contain ASCII letters, digits, '_', and '-'; received ${JSON.stringify(value)}.`,
    );
  }
}

export function buildEmployeeHrDocumentVersionKey(
  organisationId: string,
  personId: string,
  documentId: string,
  versionId: string,
): string {
  validateKeyComponent('organisationId', organisationId);
  validateKeyComponent('personId', personId);
  validateKeyComponent('documentId', documentId);
  validateKeyComponent('versionId', versionId);

  const key =
    `org_${organisationId}/hr_employee_${personId}/document_${documentId}/version_${versionId}`;
  validateStorageKey(key);
  return key;
}
