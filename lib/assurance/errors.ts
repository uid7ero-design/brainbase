// BrainBase Assurance — typed service errors. Zero imports; safe anywhere.
//
// Services throw these; route handlers map them to HTTP responses via
// lib/assurance/http.ts. Messages are written for end users and never
// include another tenant's data, SQL, or stack detail.

export class AssuranceError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AssuranceError';
    this.status = status;
  }
}

/** Record missing, in another organisation, or restricted from this viewer — deliberately indistinguishable. */
export class AssuranceNotFoundError extends AssuranceError {
  constructor(what = 'Record') {
    super(`${what} not found.`, 404);
    this.name = 'AssuranceNotFoundError';
  }
}

export class AssuranceValidationError extends AssuranceError {
  constructor(message: string) {
    super(message, 400);
    this.name = 'AssuranceValidationError';
  }
}

/** A valid request that the record's current state does not allow (e.g. closing without verification). */
export class AssuranceConflictError extends AssuranceError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'AssuranceConflictError';
  }
}

/**
 * A valid change whose consequences the user has not yet confirmed. Carries
 * user-facing `details` (never another tenant's data) that the UI renders in
 * its confirmation step before resubmitting with an explicit acknowledgement.
 */
export class AssuranceConfirmationRequiredError extends AssuranceConflictError {
  readonly details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = 'AssuranceConfirmationRequiredError';
    this.details = details;
  }
}

export class AssuranceForbiddenError extends AssuranceError {
  constructor(message = 'You do not have permission to do that.') {
    super(message, 403);
    this.name = 'AssuranceForbiddenError';
  }
}
