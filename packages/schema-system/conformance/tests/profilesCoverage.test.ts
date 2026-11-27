/**
 * What profiles.json must cover: every action of every profile is some case's action, every state
 * member is read by some case, and every profile has cases of its own. A member added to a profile
 * without a vector fails here, so a second host is never handed a profile part of which nobody has
 * said the behaviour of.
 */
import { CAPABILITY_PROFILES, PROFILE_MEMBERS } from '@we/schema-shared';
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

  /*
    An action's own profile's events are what it says it may cause. One recorded beyond them is a
    member list a second host would read as wrong — or a host waking readers it should not. Events of
    other profiles are the action's description's to name (going to a space changes who is here), so
    only the action's own profile is held to its list.
  */
  it('records no event of an action’s own profile that the action does not name', () => {
    for (const c of file.cases) {
      const events = (c as { events?: Record<string, string[]> }).events;
      if (!c.action || !events) continue;
      const { profile, member } = PROFILE_MEMBERS.get(c.action)!;
      const stray = (events[profile.id] ?? []).filter((event) => !member.events.includes(event));
      expect(stray, `${c.id}: ${c.action}`).toEqual([]);
    }
  });

  it('gives every case an id of its own', () => {
    const ids = file.cases.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
