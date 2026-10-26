/**
 * The host's half of a space's rules: the presets say what they claim, the version in force is the
 * newest one somebody was allowed to write, and the write check refuses what the rules do not allow.
 */
import { evaluate, type Policy, PolicyRefusal, validatePolicy } from '@we/backend-shared';
import type { EntityWrite } from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';
import { describe, expect, it, vi } from 'vitest';

import {
  actorFacts,
  canFrom,
  COMMUNITY_POLICY,
  createPolicyCheck,
  describePolicy,
  type GovernedSpace,
  OPEN_POLICY,
  policyInForce,
  policyView,
  presetOf,
  type SpaceStanding,
} from '../src/shared/spacePolicy';
import { rolesView } from '../src/shared/spaceRoles';

const standing: SpaceStanding = {
  roles: rolesView(
    [],
    [
      { id: 'g1', role: 'admin', agent: 'did:admin' },
      { id: 'g2', role: 'moderator', agent: 'did:mod' },
      { id: 'g3', role: 'muted', agent: 'did:muted' },
    ],
  ),
  creator: 'did:admin',
};

const judge = (policy: Policy, person: string, request: Parameters<typeof evaluate>[1]) =>
  evaluate(policy, request, actorFacts(standing, person));

const catalogue = Object.fromEntries(
  Object.entries(CORE_MANIFEST.entities).map(([name, entity]) => [name, Object.keys(entity.relations ?? {})]),
);

describe('the presets', () => {
  it('are sound, and name only entities and relations the space has', () => {
    expect(validatePolicy(OPEN_POLICY, catalogue)).toEqual([]);
    expect(validatePolicy(COMMUNITY_POLICY, catalogue)).toEqual([]);
    expect(presetOf(COMMUNITY_POLICY)).toBe('community');
    expect(presetOf({ ...OPEN_POLICY, permissions: OPEN_POLICY.permissions.slice(1) })).toBeNull();
  });

  it('open: every member may do anything but change the rules and the roles', () => {
    expect(judge(OPEN_POLICY, 'did:ann', { action: 'CollectionBlock.delete', author: 'did:bob' })).toBeNull();
    expect(judge(OPEN_POLICY, 'did:ann', { action: 'Space.edit' })).toBeNull();
    expect(judge(OPEN_POLICY, 'did:ann', { action: 'Policy.edit' })?.reason).toBe('not-permitted');
    expect(judge(OPEN_POLICY, 'did:ann', { action: 'RoleGrant.create' })?.reason).toBe('not-permitted');
    expect(judge(OPEN_POLICY, 'did:admin', { action: 'RoleGrant.create' })).toBeNull();
  });

  describe('community', () => {
    const P = COMMUNITY_POLICY;

    it('lets members make things and look after their own', () => {
      expect(judge(P, 'did:ann', { action: 'CollectionBlock.create', author: 'did:ann' })).toBeNull();
      expect(judge(P, 'did:ann', { action: 'CollectionBlock.edit', author: 'did:ann' })).toBeNull();
      expect(judge(P, 'did:ann', { action: 'CollectionBlock.edit', author: 'did:bob' })?.reason).toBe('not-permitted');
      expect(judge(P, 'did:ann', { action: 'CollectionBlock.delete', author: 'did:bob' })?.reason).toBe(
        'not-permitted',
      );
      expect(judge(P, 'did:ann', { action: 'Signal.delete', author: 'did:ann' })).toBeNull();
    });

    it('lets moderators and admins delete anything', () => {
      expect(judge(P, 'did:mod', { action: 'CollectionBlock.delete', author: 'did:bob' })).toBeNull();
      expect(judge(P, 'did:admin', { action: 'Placement.delete', author: 'did:bob' })).toBeNull();
      expect(judge(P, 'did:ann', { action: 'Placement.delete', author: 'did:bob' })?.reason).toBe('not-permitted');
    });

    it('lets anybody move any card and anything on the canvas, but not rewrite somebody else’s card', () => {
      const move = { action: 'TaskBlock.edit', author: 'did:bob', changed: ['status'] };
      expect(judge(P, 'did:ann', move)).toBeNull();
      expect(judge(P, 'did:ann', { ...move, changed: ['title'] })?.reason).toBe('condition');
      expect(judge(P, 'did:bob', { ...move, changed: ['title'] })).toBeNull();
      expect(judge(P, 'did:ann', { action: 'Placement.edit', author: 'did:bob' })).toBeNull();
    });

    it('keeps the space and its vocabulary to its admins', () => {
      for (const action of [
        'Space.edit',
        'SignalType.create',
        'TaskState.edit',
        'Topic.delete',
        'SpaceLandmark.edit',
      ]) {
        expect(judge(P, 'did:ann', { action, author: 'did:ann' })?.reason).toBe('not-permitted');
        expect(judge(P, 'did:admin', { action, author: 'did:ann' })).toBeNull();
      }
      expect(judge(P, 'did:ann', { action: 'SpaceLandmark.create', author: 'did:ann' })).toBeNull();
    });

    it('takes making, editing and adding away from the muted, and leaves deleting their own', () => {
      expect(judge(P, 'did:muted', { action: 'CollectionBlock.create', author: 'did:muted' })?.reason).toBe(
        'not-permitted',
      );
      expect(judge(P, 'did:muted', { action: 'CollectionBlock.children.add', author: 'did:muted' })?.reason).toBe(
        'not-permitted',
      );
      expect(judge(P, 'did:muted', { action: 'CollectionBlock.delete', author: 'did:muted' })).toBeNull();
    });
  });
});

describe('actorFacts', () => {
  it('makes the creator an admin while nobody holds the role, and only then', () => {
    const empty: SpaceStanding = { roles: [], creator: 'did:ann' };
    expect(actorFacts(empty, 'did:ann').roles).toEqual(['admin']);
    expect(actorFacts(empty, 'did:bob').roles).toEqual([]);
    expect(actorFacts({ ...standing, creator: 'did:ann' }, 'did:ann').roles).toEqual([]);
  });
});

describe('policyInForce', () => {
  const doc = (policy: Policy) => JSON.stringify(policy);

  it('reads as open with no versions, and as the newest version an admin wrote', () => {
    expect(policyInForce([], standing)).toBe(OPEN_POLICY);
    const versions = [
      { id: 'v1', author: 'did:admin', createdAt: 1, document: doc(COMMUNITY_POLICY) },
      { id: 'v2', author: 'did:admin', createdAt: 2, document: doc(OPEN_POLICY) },
    ];
    expect(policyInForce(versions, standing)).toEqual(OPEN_POLICY);
  });

  it('ignores a version its author was not allowed to write, and one that does not parse', () => {
    const versions = [
      { id: 'v1', author: 'did:admin', createdAt: 1, document: doc(COMMUNITY_POLICY) },
      { id: 'v2', author: 'did:ann', createdAt: 2, document: doc(OPEN_POLICY) },
      { id: 'v3', author: 'did:admin', createdAt: 3, document: '{broken' },
    ];
    expect(policyInForce(versions, standing)).toEqual(COMMUNITY_POLICY);
  });

  it('judges a version by the roles held when it was written, so it outlasts its author’s role', () => {
    const grants = [
      { id: 'g1', role: 'admin', agent: 'did:ann', createdAt: 0, revokedAt: new Date(10).toISOString() },
      { id: 'g2', role: 'admin', agent: 'did:bob', createdAt: 5 },
    ];
    const history: SpaceStanding = { roles: rolesView([], grants), creator: 'did:ann', history: { roles: [], grants } };
    expect(history.roles[0].holders).toEqual(['did:bob']);
    // Ann wrote it while she was an admin; she no longer is, and it still holds.
    const written = [{ id: 'v1', author: 'did:ann', createdAt: 3, document: doc(COMMUNITY_POLICY) }];
    expect(policyInForce(written, history)).toEqual(COMMUNITY_POLICY);
    // One she wrote after stepping down does not count.
    const late = [...written, { id: 'v2', author: 'did:ann', createdAt: 20, document: doc(OPEN_POLICY) }];
    expect(policyInForce(late, history)).toEqual(COMMUNITY_POLICY);
  });

  it('judges a version by the one before it, so no version can approve itself', () => {
    const anyoneEdits: Policy = { format: 1, permissions: [{ action: 'Policy.edit', by: ['member'] }] };
    const versions = [{ id: 'v1', author: 'did:ann', createdAt: 1, document: doc(anyoneEdits) }];
    expect(policyInForce(versions, standing)).toBe(OPEN_POLICY);
    // Once an admin writes it, it is in force, and then a member's version counts.
    const after = [
      { id: 'v0', author: 'did:admin', createdAt: 0, document: doc(anyoneEdits) },
      { id: 'v1', author: 'did:ann', createdAt: 1, document: doc(COMMUNITY_POLICY) },
    ];
    expect(policyInForce(after, standing)).toEqual(COMMUNITY_POLICY);
  });
});

describe('the write check', () => {
  const governed: GovernedSpace = { ...standing, policy: COMMUNITY_POLICY };
  const setup = (me: string, space: GovernedSpace | null = governed) =>
    createPolicyCheck({
      me: async () => me,
      personOf: async (did) => did,
      space: async () => space,
    });
  const write = (over: Partial<EntityWrite>): EntityWrite => ({
    dataset: {},
    entity: 'CollectionBlock',
    kind: 'create',
    ...over,
  });

  it('lets an allowed write through without reading the record', async () => {
    const record = vi.fn(() => ({ author: 'did:ann' }));
    await expect(setup('did:ann')(write({ record }))).resolves.toBeUndefined();
    await expect(setup('did:ann')(write({ entity: 'Space', kind: 'edit', record, data: {} }))).rejects.toThrow();
    expect(record).not.toHaveBeenCalled();
  });

  it('refuses with a PolicyRefusal, reading the record when the rule needs its author', async () => {
    const record = vi.fn(() => ({ author: 'did:bob', kind: 'post' }));
    const refused = setup('did:ann')(write({ kind: 'delete', id: 'p1', record }));
    await expect(refused).rejects.toBeInstanceOf(PolicyRefusal);
    await expect(refused).rejects.toMatchObject({
      refusal: { reason: 'not-permitted', action: 'CollectionBlock.delete' },
    });
    expect(record).toHaveBeenCalled();
    await expect(setup('did:bob')(write({ kind: 'delete', id: 'p1', record }))).resolves.toBeUndefined();
  });

  it('judges an edit by the fields it changes', async () => {
    const record = () => ({ author: 'did:bob' });
    const check = setup('did:ann');
    await expect(
      check(write({ entity: 'TaskBlock', kind: 'edit', data: { status: 'done' }, record })),
    ).resolves.toBeUndefined();
    await expect(check(write({ entity: 'TaskBlock', kind: 'edit', data: { title: 'x' }, record }))).rejects.toThrow();
  });

  it('does not judge a write to anything that is not a space', async () => {
    await expect(setup('did:muted', null)(write({}))).resolves.toBeUndefined();
  });
});

describe('canFrom', () => {
  it('answers what the write check would, from the view a template holds', () => {
    const view = (me: string) => policyView(COMMUNITY_POLICY, standing, me, true);
    const post = { kind: 'post', author: 'did:bob' };
    expect(canFrom(view('did:ann'), 'CollectionBlock.delete', post)).toBe(false);
    expect(canFrom(view('did:bob'), 'CollectionBlock.delete', post)).toBe(true);
    expect(canFrom(view('did:mod'), 'CollectionBlock.delete', post)).toBe(true);
    expect(canFrom(view('did:ann'), 'CollectionBlock.create')).toBe(true);
    expect(canFrom(view('did:muted'), 'CollectionBlock.create')).toBe(false);
    expect(canFrom({ ...view('did:ann'), loaded: false }, 'CollectionBlock.create')).toBe(false);
  });
});

describe('describePolicy', () => {
  it('says each permission as a sentence, naming roles as the community does', () => {
    const roles = rolesView([{ id: 'r', slug: 'moderator', name: 'Steward' }], []);
    expect(describePolicy(COMMUNITY_POLICY, roles).slice(0, 3)).toEqual([
      'Members, except anyone muted, may make anything.',
      'The author and admins, except anyone muted, may edit anything.',
      'The author, stewards and admins may delete anything.',
    ]);
    expect(describePolicy(COMMUNITY_POLICY)).toContain(
      'Members, except anyone muted, may edit tasks, changing only the status.',
    );
    expect(describePolicy(COMMUNITY_POLICY)).toContain('Admins may delete the space.');
  });
});
