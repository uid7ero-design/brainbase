import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// Duplicate organisation names are not prevented at the DB or app level
// (only `slug` is unique) — the "Add User" organisation dropdown must show
// the slug alongside the name so an admin can't accidentally attach a user
// to the wrong same-named organisation. This guards against that dropdown
// label regressing back to name-only.
describe('/admin/users — organisation dropdown disambiguation', () => {
  it('renders each organisation option with both name and slug', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, '../../app/admin/users/UsersClient.tsx'),
      'utf-8',
    );
    expect(source).toMatch(/orgs\.map\(o => <option key={o\.id} value={o\.id}>\{o\.name\} \(\{o\.slug\}\)<\/option>\)/);
  });
});
