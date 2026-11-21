/**
 * Presence across a person's computers: each computer beats on its own, so presence stays one peer per
 * device — but a peer is drawn as its person, and "is this me" leaves out every computer of mine, not
 * only the one I am on.
 */
import type { AgentProfileSummary, Peer } from '@we/backend-shared';
import { evaluateExpression, listFunctions, parseExpression } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { presentAs } from '../src/shared/presenceScope';

const PERSON = 'did:scid:test:1:QmTestMe';
const DESKTOP = 'did:key:z6MkTestDesktop';
const LAPTOP = 'did:key:z6MkTestLaptop';
const ANA = 'did:key:z6MkTestAna';
const NEWCOMER = 'did:key:z6MkTestNewcomer';

const peer = (agentId: string): Peer =>
  ({ agentId, updatedAt: 1, availability: 'available', liveness: 'online' }) as Peer;
const profile = (did: string, name: string, device?: string): AgentProfileSummary =>
  ({
    did,
    name,
    firstName: name,
    lastName: '',
    handle: '',
    bio: '',
    ...(device ? { device } : {}),
  }) as AgentProfileSummary;

const profiles: Record<string, AgentProfileSummary> = {
  [DESKTOP]: profile(PERSON, 'Robin', DESKTOP),
  [LAPTOP]: profile(PERSON, 'Robin', LAPTOP),
  [ANA]: profile(ANA, 'Ana'),
};
const profileFor = (did: string) => profiles[did];

/** `!(p.did in me.dids)` — the filter every "who else is here" list uses — evaluated as a template would. */
function others(online: unknown[], me: { did: string; dids: string[] }): { did: string }[] {
  const roots: Record<string, unknown> = { me, presenceStore: { online } };
  return evaluateExpression(parseExpression('presenceStore.online.filter(p, !(p.did in me.dids))'), {
    root: (name) => ({ bound: name in roots, value: roots[name] }),
    call: (name, args) =>
      listFunctions()
        .find((f) => f.name === name)
        ?.impl(args, { context: {}, stores: {} }),
  }) as { did: string }[];
}

describe('presentAs', () => {
  it('draws a device as its person and keeps the device as the peer', () => {
    expect(presentAs(peer(LAPTOP), profileFor)).toMatchObject({ did: LAPTOP, person: PERSON, name: 'Robin' });
  });

  it('gives two computers of one person one `person`, and stays two peers', () => {
    const online = [peer(DESKTOP), peer(LAPTOP)].map((p) => presentAs(p, profileFor));
    expect(online.map((p) => p.did)).toEqual([DESKTOP, LAPTOP]);
    expect(new Set(online.map((p) => p.person))).toEqual(new Set([PERSON]));
  });

  it('leaves a peer that is its own person, or has no profile yet, as itself', () => {
    expect(presentAs(peer(ANA), profileFor)).toMatchObject({ did: ANA, person: ANA, name: 'Ana' });
    expect(presentAs(peer(NEWCOMER), profileFor)).toMatchObject({ did: NEWCOMER, person: NEWCOMER });
  });
});

describe('who else is here', () => {
  it('leaves out my other computer as well as this one', () => {
    const online = [peer(DESKTOP), peer(LAPTOP), peer(ANA)].map((p) => presentAs(p, profileFor));
    const me = { did: DESKTOP, dids: [DESKTOP, LAPTOP, PERSON] };
    expect(others(online, me).map((p) => p.did)).toEqual([ANA]);
  });

  it('counts my laptop as somebody else when it is not one of mine', () => {
    // Before the device was linked to the person, the laptop was a stranger — and is listed as one.
    const online = [peer(DESKTOP), peer(LAPTOP), peer(ANA)].map((p) => presentAs(p, profileFor));
    const me = { did: DESKTOP, dids: [DESKTOP] };
    expect(others(online, me).map((p) => p.did)).toEqual([LAPTOP, ANA]);
  });
});
