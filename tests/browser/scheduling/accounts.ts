// The synthetic accounts the orchestrator seeds (scripts/tests/helpers/schedulingBrowserEnv.mjs). Passwords are per run and
// only ever travel through the environment of the test process.
export const ACCOUNTS = ['owner', 'manager', 'viewer', 'viewer-none', 'analyst', 'analyst-legacy', 'manager-legacy', 'foreign-manager', 'unentitled-manager', 'unentitled-legacy', 'viewer-legacy', 'viewer-use', 'manager-view'] as const;
export type Account = (typeof ACCOUNTS)[number];

export const origin = process.env.SCHED_BROWSER_ORIGIN ?? '';
export const stateDir = process.env.SCHED_BROWSER_STATE_DIR ?? '';
export const enabled = Boolean(origin && stateDir && process.env.SCHED_BROWSER_PASSWORD);
export const storageStatePath = (account: Account) => `${stateDir}/${account}.json`;
