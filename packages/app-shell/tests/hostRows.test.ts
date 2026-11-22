/** The words the host screens use for usage, people and invites. */
import type { HostInviteView, HostTenantView, TenantUsageView } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { formatBytes, inviteRows, isHeld, personRows, usageLines } from '../src/shared/hostRows';

const usage = (over: Partial<TenantUsageView> = {}): TenantUsageView => ({
  tenantId: 't',
  didScid: 'did:scid:coasys:1:Qm',
  state: 'active',
  activatedAt: 1,
  host: { name: 'A host', runByCoasys: false, operatorDid: 'did:key:z' },
  spaces: [],
  privatePerspectives: 1,
  storage: { usedBytes: 0, measuredAt: '' },
  aiRuns: { day: '', count: 0 },
  spend: { freeAccess: false, credits: null, rates: null, chargedSoFar: 3 },
  ...over,
});

describe('hostRows', () => {
  it('writes sizes in the unit a person reads', () => {
    expect(formatBytes(0)).toBe('0 bytes');
    expect(formatBytes(999)).toBe('999 bytes');
    expect(formatBytes(1500)).toBe('1.5 KB');
    expect(formatBytes(2_000_000)).toBe('2 MB');
    expect(formatBytes(250_000_000)).toBe('250 MB');
    expect(formatBytes(-5)).toBe('0 bytes');
  });

  it('says what a person spends, with the singular where there is one', () => {
    expect(usageLines(usage()).spend).toBe('3 charged so far');
    expect(usageLines(usage({ spend: { freeAccess: false, credits: 1, rates: null, chargedSoFar: 0 } })).spend).toBe(
      '1 credit left',
    );
    expect(usageLines(usage({ spend: { freeAccess: false, credits: 5, rates: null, chargedSoFar: 0 } })).spend).toBe(
      '5 credits left',
    );
    expect(usageLines(usage({ spend: { freeAccess: true, credits: null, rates: null, chargedSoFar: 0 } })).spend).toBe(
      'Free during the closed beta',
    );
  });

  it('names a space with no name, and says who else can see it', () => {
    const lines = usageLines(
      usage({
        spaces: [
          { perspectiveUuid: 'a', name: null, neighbourhoodUrl: 'n://a', sharedWithOtherTenants: false },
          { perspectiveUuid: 'b', name: 'Club', neighbourhoodUrl: 'n://b', sharedWithOtherTenants: true },
        ],
      }),
    );
    expect(lines.spaces).toEqual([
      { name: 'Untitled space', shared: 'Only you' },
      { name: 'Club', shared: 'Shared with other people on this host' },
    ]);
    expect(lines.privateSpaces).toBe('1 private space');
  });

  it('holds a tenant only when the host says held', () => {
    expect(isHeld(usage({ state: 'held' }))).toBe(true);
    expect(isHeld(usage())).toBe(false);
    expect(isHeld(null)).toBe(false);
  });

  it('names each state of a person, and a state it does not know as Unknown', () => {
    const tenant = (state: string): HostTenantView => ({
      tenantId: state,
      didScid: 'did:scid:coasys:1:QmZZZZZZ',
      state,
      createdAt: 1,
      activatedAt: null,
      detachedAt: null,
    });
    const rows = personRows(['pending', 'active', 'held', 'detached', 'deleted', 'new-state'].map(tenant));
    expect(rows.map((r) => r.state)).toEqual(['Joining', 'Active', 'On hold', 'Left', 'Deleted', 'Unknown']);
    // Only a person who left can be removed.
    expect(rows.filter((r) => r.canRemove).map((r) => r.id)).toEqual(['detached']);
    expect(rows[0].label).toBe('Person ZZZZZZ');
  });

  it('gives an invite one status, and revokes only an open one', () => {
    const invite = (over: Partial<HostInviteView>): HostInviteView => ({
      id: 'i',
      createdAt: 1,
      expiresAt: 200,
      usedBy: null,
      revoked: false,
      note: null,
      ...over,
    });
    const rows = inviteRows(
      [invite({}), invite({ usedBy: 't' }), invite({ revoked: true, usedBy: 't' }), invite({ expiresAt: 50 })],
      100,
    );
    expect(rows.map((r) => r.status)).toEqual(['Open', 'Used', 'Revoked', 'Expired']);
    expect(rows.map((r) => r.canRevoke)).toEqual([true, false, false, false]);
    expect(rows[0].note).toBe('No note');
  });
});
