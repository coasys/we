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

/**
 * State no case can pin without naming the host's own catalogue. Which theme is on screen is the
 * host's resolution of the person's choice, the space's and the template's own, over the themes that
 * host has — so the value is a host's theme id, and the same world gives another host another one.
 */
const UNPINNED = new Set(['themeStore.currentThemeId']);

describe('profiles.json covers the profiles', () => {
  it('calls every action of every profile in some case', () => {
    const called = new Set(file.cases.map((c) => c.action).filter(Boolean));
    expect(actions.filter((path) => !called.has(path))).toEqual([]);
  });

  it('reads every state member of every profile in some case', () => {
    const read = new Set(file.cases.flatMap((c) => c.observe));
    expect(states.filter((path) => !read.has(path) && !UNPINNED.has(path))).toEqual([]);
    for (const path of UNPINNED) expect(read.has(path), `${path} is read after all; take it off the list`).toBe(false);
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
