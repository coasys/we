import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_PROFILES,
  HOST_ONLY_EQUIVALENTS,
  NEUTRAL_NAMESPACES,
  PROFILE_MEMBERS,
  PROFILE_NAMESPACES,
  profileMemberNamed,
} from '../src/profiles';

describe('capability profiles', () => {
  it('are the seven, each versioned', () => {
    expect(CAPABILITY_PROFILES.map((p) => p.id)).toEqual([
      'navigation',
      'view-state',
      'layout',
      'presence',
      'identity',
      'space-settings',
      'appearance',
    ]);
    for (const profile of CAPABILITY_PROFILES) expect(profile.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('are drafts at 0.x while WE is the only host providing them', () => {
    // A profile freezes at 1.0.0 when a second host passes its vectors; raising one here is that
    // decision, made on purpose. See the profiles spec, "Versioning".
    for (const profile of CAPABILITY_PROFILES) expect(profile.version).toMatch(/^0\.\d+\.\d+$/);
  });

  it('are written under namespaces of their own, never a store name', () => {
    expect(CAPABILITY_PROFILES.map((p) => p.namespace)).toEqual([
      'navigation',
      'viewState',
      'layout',
      'presence',
      'identity',
      'spaceSettings',
      'appearance',
    ]);
    expect(PROFILE_NAMESPACES.size).toBe(CAPABILITY_PROFILES.length);
    for (const profile of CAPABILITY_PROFILES) {
      expect(profile.namespace).toMatch(/^[a-z][a-zA-Z]*$/);
      expect(profile.namespace).not.toMatch(/Store$/);
      expect(NEUTRAL_NAMESPACES.has(profile.namespace)).toBe(false);
      for (const member of profile.members) expect(member.path.split('.')[0], member.path).toBe(profile.namespace);
    }
  });

  it('give every member a name no other profile uses, so a bare member name finds it', () => {
    const names = CAPABILITY_PROFILES.flatMap((p) => p.members.map((m) => m.path.split('.')[1]));
    expect(new Set(names).size).toBe(names.length);
    expect(profileMemberNamed('params')?.path).toBe('navigation.params');
    expect(profileMemberNamed('policy')).toBeUndefined();
  });

  it('are plain JSON, since another host reads them as data', () => {
    expect(JSON.parse(JSON.stringify(CAPABILITY_PROFILES))).toEqual(CAPABILITY_PROFILES);
  });

  it('hold each member once, in one profile', () => {
    const paths = CAPABILITY_PROFILES.flatMap((p) => p.members.map((m) => m.path));
    expect(new Set(paths).size).toBe(paths.length);
    expect(PROFILE_MEMBERS.size).toBe(paths.length);
  });

  it('describe state by its shape and actions by their arguments', () => {
    for (const { member } of PROFILE_MEMBERS.values()) {
      expect(member.path).toMatch(/^[a-z]\w*\.[a-zA-Z]\w*$/);
      expect(NEUTRAL_NAMESPACES.has(member.path.split('.')[0])).toBe(false);
      if (member.kind === 'state') {
        expect(member.shape, member.path).toBeTruthy();
        expect(member.args, member.path).toBeUndefined();
        expect(member.ambient, member.path).toBeUndefined();
      } else {
        expect(member.args, member.path).toBeDefined();
        expect(member.shape, member.path).toBeUndefined();
      }
    }
  });

  it('name only their own events, and every state member changes through one', () => {
    for (const profile of CAPABILITY_PROFILES) {
      const events = new Map(profile.events.map((e) => [e.name, e]));
      const own = new Set(profile.members.map((m) => m.path));
      for (const member of profile.members)
        for (const name of member.events) expect(events.has(name), `${member.path} → ${name}`).toBe(true);
      for (const event of profile.events)
        for (const path of event.changes) expect(own.has(path), `${profile.id}.${event.name} → ${path}`).toBe(true);
      for (const member of profile.members.filter((m) => m.kind === 'state')) {
        const announcing = profile.events.filter((e) => e.changes.includes(member.path)).map((e) => e.name);
        expect(announcing.length, `${member.path} has no change event`).toBeGreaterThan(0);
        expect([...member.events].sort(), member.path).toEqual(announcing.sort());
      }
    }
  });

  it('never offer a neutral equivalent for a member a profile holds', () => {
    for (const member of Object.keys(HOST_ONLY_EQUIVALENTS)) expect(PROFILE_MEMBERS.has(member), member).toBe(false);
  });
});
