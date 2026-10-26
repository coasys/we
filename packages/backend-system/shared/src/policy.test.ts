/**
 * The policy evaluator and its checks: an allow-list read top to bottom, `except` taking people out,
 * `when` narrowing, wildcards covering what is not named, and a policy that cannot lock itself by
 * accident.
 */
import { describe, expect, it } from 'vitest';

import {
  actionOf,
  type ActorFacts,
  evaluate,
  isPolicyRefusal,
  needsRecord,
  type Policy,
  POLICY_FORMAT,
  PolicyRefusal,
  policyWarnings,
  readPolicy,
  validatePolicy,
} from './policy';

const ADMIN_EDITS = { action: 'Policy.edit', by: [{ role: 'admin' }] };

const POLICY: Policy = {
  format: POLICY_FORMAT,
  permissions: [
    { action: '*.create', by: ['member'], except: [{ role: 'muted' }] },
    { action: '*.edit', by: ['author', { role: 'admin' }] },
    { action: '*.delete', by: ['author', { role: 'moderator' }] },
    { action: 'TaskBlock.edit', by: ['member'], when: { change: { only: ['status'] } } },
    { action: 'Space.edit', by: [{ role: 'admin' }] },
    { action: 'CollectionBlock.delete', by: [{ role: 'moderator' }], when: { record: { kind: 'post' } } },
    ADMIN_EDITS,
  ],
};

const ann: ActorFacts = { person: 'did:ann', member: true, roles: [] };
const bob: ActorFacts = { person: 'did:bob', member: true, roles: [] };
const mod: ActorFacts = { person: 'did:mod', member: true, roles: ['moderator'] };
const admin: ActorFacts = { person: 'did:admin', member: true, roles: ['admin'] };
const stranger: ActorFacts = { person: 'did:who', member: false, roles: [] };

describe('evaluate', () => {
  it('allows what a permission allows, and nothing else', () => {
    expect(evaluate(POLICY, { action: 'TextBlock.create', author: 'did:ann' }, ann)).toBeNull();
    expect(evaluate(POLICY, { action: 'TextBlock.create', author: 'did:who' }, stranger)).toEqual({
      reason: 'not-permitted',
      action: 'TextBlock.create',
    });
  });

  it('takes the people `except` names out, even when `by` reaches them', () => {
    const muted = { ...ann, roles: ['muted'] };
    expect(evaluate(POLICY, { action: 'TextBlock.create', author: 'did:ann' }, muted)?.reason).toBe('not-permitted');
  });

  it('lets an author edit their own record and nobody else’s', () => {
    expect(evaluate(POLICY, { action: 'TextBlock.edit', author: 'did:ann' }, ann)).toBeNull();
    expect(evaluate(POLICY, { action: 'TextBlock.edit', author: 'did:ann' }, bob)?.reason).toBe('not-permitted');
    expect(evaluate(POLICY, { action: 'TextBlock.edit', author: 'did:ann' }, admin)).toBeNull();
  });

  it('governs an action named exactly by its own permissions alone', () => {
    // `*.edit` would let Ann edit her own space; `Space.edit` names it, so only admins may.
    expect(evaluate(POLICY, { action: 'Space.edit', author: 'did:ann' }, ann)?.reason).toBe('not-permitted');
    expect(evaluate(POLICY, { action: 'Space.edit', author: 'did:ann' }, admin)).toBeNull();
    // `*.delete` would let an author delete their own post; `CollectionBlock.delete` names it.
    const post = { kind: 'post' };
    expect(evaluate(POLICY, { action: 'CollectionBlock.delete', author: 'did:ann', before: post }, ann)?.reason).toBe(
      'not-permitted',
    );
  });

  it('applies `when` to the record, and says when that is what failed', () => {
    const reply = { kind: 'reply' };
    expect(
      evaluate(POLICY, { action: 'CollectionBlock.delete', author: 'did:ann', before: { kind: 'post' } }, mod),
    ).toBeNull();
    expect(evaluate(POLICY, { action: 'CollectionBlock.delete', author: 'did:ann', before: reply }, mod)).toEqual({
      reason: 'condition',
      action: 'CollectionBlock.delete',
      permission: 5,
    });
  });

  it('holds `when.record` before and after an edit, so an edit cannot escape it', () => {
    const policy: Policy = {
      format: 1,
      permissions: [
        { action: 'CollectionBlock.edit', by: ['member'], when: { record: { kind: 'note' } } },
        ADMIN_EDITS,
      ],
    };
    const request = { action: 'CollectionBlock.edit', before: { kind: 'note' }, after: { kind: 'post' } };
    expect(evaluate(policy, request, ann)?.reason).toBe('condition');
  });

  it('limits which fields an edit touches', () => {
    const move = { action: 'TaskBlock.edit', author: 'did:ann', changed: ['status'] };
    expect(evaluate(POLICY, move, bob)).toBeNull();
    expect(evaluate(POLICY, { ...move, changed: ['status', 'title'] }, bob)?.reason).toBe('condition');
  });

  it('never lets a wildcard reach the governance actions', () => {
    const open: Policy = { format: 1, permissions: [{ action: '*', by: ['member'] }, ADMIN_EDITS] };
    expect(evaluate(open, { action: 'Post.edit' }, ann)).toBeNull();
    for (const action of ['Policy.edit', 'RoleGrant.create', 'Role.delete', 'RoleGrant.role.add']) {
      expect(evaluate(open, { action }, ann)?.reason).toBe('not-permitted');
    }
    expect(evaluate(open, { action: 'Policy.edit' }, admin)).toBeNull();
  });

  it('covers a relation with the relation wildcards only', () => {
    const policy: Policy = { format: 1, permissions: [{ action: '*.*.add', by: ['member'] }, ADMIN_EDITS] };
    expect(evaluate(policy, { action: 'CollectionBlock.children.add' }, ann)).toBeNull();
    expect(evaluate(policy, { action: 'CollectionBlock.children.remove' }, ann)?.reason).toBe('not-permitted');
    expect(evaluate(policy, { action: 'CollectionBlock.create' }, ann)?.reason).toBe('not-permitted');
  });

  it('refuses every edit to a frozen policy, and every write under a newer format', () => {
    const frozen: Policy = { format: 1, frozen: true, permissions: [{ action: '*', by: ['anyone'] }] };
    expect(evaluate(frozen, { action: 'Policy.edit' }, admin)?.reason).toBe('frozen');
    const newer: Policy = { ...POLICY, format: POLICY_FORMAT + 1 };
    expect(evaluate(newer, { action: 'TextBlock.create' }, admin)?.reason).toBe('newer-format');
  });
});

describe('actionOf', () => {
  it('names the built-in actions, and every policy write as Policy.edit', () => {
    expect(actionOf('Post', 'create')).toBe('Post.create');
    expect(actionOf('CollectionBlock', 'add', 'children')).toBe('CollectionBlock.children.add');
    expect(actionOf('Policy', 'create')).toBe('Policy.edit');
    expect(actionOf('Policy', 'delete')).toBe('Policy.edit');
  });
});

describe('needsRecord', () => {
  it('says when judging an action reads the record', () => {
    expect(needsRecord(POLICY, 'TextBlock.create')).toBe(false);
    expect(needsRecord(POLICY, 'TextBlock.edit')).toBe(true);
    expect(needsRecord(POLICY, 'CollectionBlock.delete')).toBe(true);
    expect(needsRecord(POLICY, 'Space.edit')).toBe(false);
  });
});

describe('validatePolicy', () => {
  it('accepts a sound policy', () => {
    expect(validatePolicy(POLICY)).toEqual([]);
  });

  it('refuses a policy nobody could edit again, unless it says it is frozen', () => {
    const locked: Policy = { format: 1, permissions: [{ action: '*', by: ['member'] }] };
    expect(validatePolicy(locked)).toEqual([expect.stringContaining('Nobody could ever change this policy again')]);
    expect(validatePolicy({ ...locked, frozen: true })).toEqual([]);
    expect(validatePolicy({ ...POLICY, frozen: true })).toEqual([expect.stringContaining('frozen and also')]);
  });

  it('refuses malformed permissions', () => {
    const bad: Policy = {
      format: 1,
      permissions: [
        { action: 'delete everything', by: ['member'] },
        { action: 'Post.create', by: [] },
        { action: 'Post.create', by: [{ role: '' }] },
        { action: 'Post.delete', by: ['member'], when: { change: { only: ['title'] } } },
        ADMIN_EDITS,
      ],
    };
    expect(validatePolicy(bad)).toHaveLength(4);
  });

  it('refuses a newer format, and with a catalogue, names the space does not have', () => {
    expect(validatePolicy({ ...POLICY, format: POLICY_FORMAT + 1 })).toHaveLength(1);
    const catalogue = { Post: ['responses'] };
    const policy: Policy = {
      format: 1,
      permissions: [
        { action: 'Psot.create', by: ['member'] },
        { action: 'Post.repsonses.add', by: ['member'] },
        { action: 'Post.responses.add', by: ['member'] },
        ADMIN_EDITS,
      ],
    };
    expect(validatePolicy(policy, catalogue)).toHaveLength(2);
  });
});

describe('policyWarnings', () => {
  it('warns when more people may hand out roles than may change the rules', () => {
    const policy: Policy = {
      format: 1,
      permissions: [ADMIN_EDITS, { action: 'RoleGrant.create', by: ['member'] }],
    };
    expect(policyWarnings(policy)).toHaveLength(1);
    expect(
      policyWarnings({ ...policy, permissions: [ADMIN_EDITS, { ...ADMIN_EDITS, action: 'RoleGrant.create' }] }),
    ).toEqual([]);
  });
});

describe('readPolicy', () => {
  it('reads a stored document, dropping only the permissions that do not parse', () => {
    const stored = JSON.stringify({
      format: 1,
      permissions: [ADMIN_EDITS, { action: 'Post.create', by: ['everybody'] }, { action: 'Post.edit' }],
    });
    expect(readPolicy(stored)).toEqual({ format: 1, permissions: [ADMIN_EDITS] });
    expect(readPolicy('{nope')).toBeNull();
    expect(readPolicy({ permissions: [] })).toBeNull();
  });
});

describe('PolicyRefusal', () => {
  it('carries the refusal and reads as one after crossing a boundary', () => {
    const error = new PolicyRefusal({ reason: 'not-permitted', action: 'Post.delete' });
    expect(error.message).toContain('Post.delete');
    expect(isPolicyRefusal(error)).toBe(true);
    expect(isPolicyRefusal({ name: 'PolicyRefusal', message: '' })).toBe(true);
    expect(isPolicyRefusal(new Error('no'))).toBe(false);
  });
});
