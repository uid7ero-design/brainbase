// Placeholder env vars so modules that eagerly construct clients at import
// time (e.g. lib/db.ts's `neon(process.env.DATABASE_URL!)`, lib/session.ts's
// key encoding) don't throw during test collection. Tests never perform a
// real DB query or JWT round-trip through these — they mock the modules that
// would actually use these values (see individual test files).
process.env.DATABASE_URL ??= 'postgresql://test:test@localhost:5432/test';
process.env.SESSION_SECRET ??= 'test-session-secret-not-for-production-0000000000000000';
