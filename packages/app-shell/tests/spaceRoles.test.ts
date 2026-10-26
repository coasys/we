/**
 * The standings people hold across a space: who holds which role, who administers, and the one
 * change that is refused — leaving a space with no admin.
 */
import { describe, expect, it } from 'vitest';

import { ADMIN_ROLE, administers, cannotRevoke, rolesByPerson, rolesOf, rolesView } from '../src/shared/spaceRoles';

const ANA = 'did:ana';
const BEN = 'did:ben';

const roles = [
  { id: 'r-mod', slug: 'moderator', name: 'Moderator', description: 'Removes what breaks the rules' },
  { id: 'r-admin', slug: 'admin', name: 'Admin' },
];

describe('rolesView', () => {
  it('lists admin first, each role with its holders once, in the order they were granted', () => {
    const view = rolesView(roles, [
      { id: 'g1', role: 'moderator', agent: BEN },
      { id: 'g2', role: 'admin', agent: ANA },
      { id: 'g3', role: 'moderator', agent: ANA },
      { id: 'g4', role: 'moderator', agent: BEN },
    ]);
    expect(view.map((r) => [r.slug, r.holders])).toEqual([
      ['admin', [ANA]],
      ['moderator', [BEN, ANA]],
    ]);
    expect(view[1]).toMatchObject({ id: 'r-mod', name: 'Moderator', description: 'Removes what breaks the rules' });
  });

  it('shows a role a grant names but no record describes, under its slug', () => {
    expect(rolesView([], [{ id: 'g1', role: 'steward', agent: ANA }])).toEqual([
      { id: '', slug: 'steward', name: 'steward', description: '', holders: [ANA] },
    ]);
  });

  it('ignores a record without a slug, a second record of one slug, and a grant missing either half', () => {
    const view = rolesView(
      [{ id: 'x' }, ...roles, { id: 'dup', slug: 'admin', name: 'Second' }],
      [
        { id: 'g1', role: 'admin' },
        { id: 'g2', agent: ANA },
      ],
    );
    expect(view.map((r) => [r.slug, r.name, r.holders])).toEqual([
      ['admin', 'Admin', []],
      ['moderator', 'Moderator', []],
    ]);
  });
});

describe('rolesOf and rolesByPerson', () => {
  const view = rolesView(roles, [
    { id: 'g1', role: 'admin', agent: ANA },
    { id: 'g2', role: 'moderator', agent: ANA },
    { id: 'g3', role: 'moderator', agent: BEN },
  ]);

  it('says which roles a person holds', () => {
    expect(rolesOf(view, ANA)).toEqual(['admin', 'moderator']);
    expect(rolesOf(view, BEN)).toEqual(['moderator']);
    expect(rolesOf(view, 'did:nobody')).toEqual([]);
    expect(rolesOf(view, undefined)).toEqual([]);
  });

  it('maps each holder to what they hold', () => {
    expect(rolesByPerson(view)).toEqual({ [ANA]: ['admin', 'moderator'], [BEN]: ['moderator'] });
  });
});

describe('administers', () => {
  it('is holding admin, where anybody does', () => {
    const view = rolesView(roles, [{ id: 'g1', role: ADMIN_ROLE, agent: BEN }]);
    expect(administers(view, BEN, ANA)).toBe(true);
    // Having made the space is no way in once somebody holds the role.
    expect(administers(view, ANA, ANA)).toBe(false);
  });

  it('falls back to whoever made the space while nobody holds admin', () => {
    const view = rolesView(roles, []);
    expect(administers(view, ANA, ANA)).toBe(true);
    expect(administers(view, BEN, ANA)).toBe(false);
  });

  it('is nobody without a person, or without an author to fall back to', () => {
    expect(administers(rolesView(roles, []), undefined, ANA)).toBe(false);
    expect(administers(rolesView(roles, []), ANA, '')).toBe(false);
  });
});

describe('cannotRevoke', () => {
  it('refuses to take admin from the last person holding it', () => {
    const view = rolesView(roles, [{ id: 'g1', role: ADMIN_ROLE, agent: ANA }]);
    expect(cannotRevoke(view, ADMIN_ROLE, ANA)).toMatch(/somebody else has to be an admin first/i);
  });

  it('allows it while another admin remains, and for any other role', () => {
    const two = rolesView(roles, [
      { id: 'g1', role: ADMIN_ROLE, agent: ANA },
      { id: 'g2', role: ADMIN_ROLE, agent: BEN },
    ]);
    expect(cannotRevoke(two, ADMIN_ROLE, ANA)).toBeNull();
    const one = rolesView(roles, [{ id: 'g3', role: 'moderator', agent: ANA }]);
    expect(cannotRevoke(one, 'moderator', ANA)).toBeNull();
  });
});
