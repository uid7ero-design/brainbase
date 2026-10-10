export const WORKER_TYPES = ['employee', 'contractor', 'casual', 'volunteer', 'other'] as const;
export type WorkerType = typeof WORKER_TYPES[number];
export const EMPLOYMENT_STATUSES = ['active', 'inactive', 'onboarding', 'ended'] as const;
export type EmploymentStatus = typeof EMPLOYMENT_STATUSES[number];
