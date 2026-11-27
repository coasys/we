/**
 * What profiles.json must cover: every action of every profile is some case's action, every state
 * member is read by some case, and every profile has cases of its own. A member added to a profile
 * without a vector fails here, so a second host is never handed a profile part of which nobody has
 * said the behaviour of.
 */
import { CAPABILITY_PROFILES } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { readProfileVectors } from '../src/profiles';

const file = readProfileVectors();
const members = CAPABILITY_PROFILES.flatMap((profile) => profile.members);
const actions = members.filter((m) => m.kind === 'action').map((m) => m.path);
const states = members.filter((m) => m.kind === 'state').map((m) => m.path);

describe('profiles.json covers the profiles', () => {
  it('calls every action of every profile in some case', () => {
    const called = new Set(file.cases.map((c) => c.action).filter(Boolean));
    expect(actions.filter((path) => !called.has(path))).toEqual([]);
  });

  it('reads every state member of every profile in some case', () => {
    const read = new Set(file.cases.flatMap((c) => c.observe));
    expect(states.filter((path) => !read.has(path))).toEqual([]);
  });

  it('has cases for every profile, each naming one that exists', () => {
    const ids = CAPABILITY_PROFILES.map((p) => p.id);
    expect(new Set(file.cases.map((c) => c.profile))).toEqual(new Set(ids));
  });

  it('names nothing but profile members, and only actions as actions', () => {
    const all = new Set(members.map((m) => m.path));
    for (const c of file.cases) {
      for (const path of [...c.observe, ...(c.action ? [c.action] : []), ...(c.setup ?? []).map((s) => s.action)])
        expect(all.has(path), `${c.id}: ${path}`).toBe(true);
      for (const path of c.observe) expect(states, `${c.id}: ${path}`).toContain(path);
    }
  });

  it('gives every case an id of its own', () => {
    const ids = file.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
