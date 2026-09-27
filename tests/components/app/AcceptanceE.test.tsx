import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderBrainbase } from '../../a11y/render';
import { expectNoAxeViolations } from '../../a11y/axe';

// Phase E — the two profile surfaces that were still forced dark, rendered
// for real (jsdom) in both themes: labelled fields, a stateful Secure Mode
// switch, one h1, and no axe violations.

vi.mock('@/app/actions/profile', () => ({
  updateProfile: vi.fn(async () => undefined),
  updatePassword: vi.fn(async () => undefined),
  updateSecureMode: vi.fn(async () => undefined),
}));

const { default: AccountProfileClient } = await import('@/app/account/profile/ProfileClient');
const { default: ProfileClient } = await import('@/app/profile/ProfileClient');

const USER = {
  first_name: 'Avery', last_name: 'Nguyen', display_name: '', bio: 'Runs kerbside operations.',
  job_title: 'Operations lead', department: 'Waste', phone: '', timezone: 'Australia/Adelaide', avatar_url: '',
};
const ORG = { name: 'Harbour Council', industry: 'Local government' };
const MODULES = [{ key: 'waste_recycling', name: 'Waste & Recycling', description: 'Collections and contamination' }];

describe.each(['light', 'dark'] as const)('Phase E profile surfaces (%s)', theme => {
  it('/account/profile view mode has one h1, named sections and no axe violations', async () => {
    const { container } = renderBrainbase(
      <AccountProfileClient initialUser={USER} org={ORG} modules={MODULES} role="manager" />, { theme });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 2, name: 'Work Details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change profile photo' })).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it('/account/profile edit mode labels every control', async () => {
    const { container, user } = renderBrainbase(
      <AccountProfileClient initialUser={USER} org={ORG} modules={MODULES} role="manager" />, { theme });
    await user.click(screen.getByRole('button', { name: /Edit Profile/ }));
    for (const name of ['First Name', 'Last Name', 'Display Name', 'Bio', 'Job Title', 'Department', 'Phone', 'Timezone']) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
    await expectNoAxeViolations(container);
  });

  it('/profile labels its fields and exposes Secure Mode as a switch', async () => {
    const { container } = renderBrainbase(
      <ProfileClient name="Avery Nguyen" username="avery" secureModeDefault={false} />, { theme });
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Current password')).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Secure Mode' });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    await expectNoAxeViolations(container);
  });
});
