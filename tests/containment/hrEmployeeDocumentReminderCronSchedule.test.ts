import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const configPath = path.resolve(__dirname, '../../vercel.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
  crons?: Array<{ path?: string; schedule?: string }>;
};

describe('HR-7E5H employee document reminder Vercel cron schedule', () => {
  it('schedules the HR reminder cron route once daily after the UTC date boundary', () => {
    const matches = (config.crons ?? []).filter(
      entry => entry.path === '/api/cron/hr-employee-document-reminders',
    );

    expect(matches).toEqual([
      {
        path: '/api/cron/hr-employee-document-reminders',
        schedule: '15 0 * * *',
      },
    ]);
  });

  it('does not alter the existing sync and ticket-email-recovery schedules', () => {
    expect(config.crons).toEqual(expect.arrayContaining([
      {
        path: '/api/cron/sync',
        schedule: '0 2 * * *',
      },
      {
        path: '/api/cron/ticket-email-recovery',
        schedule: '0 * * * *',
      },
    ]));
  });

  it('contains no duplicate cron paths', () => {
    const paths = (config.crons ?? []).map(entry => entry.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});
