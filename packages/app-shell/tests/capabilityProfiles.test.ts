/**
 * The capability profiles, held to the template surface.
 *
 * The profiles are written down twice on purpose: as language-neutral data in `@we/schema-shared`,
 * which another host reads, and as the classification in `templateSurface.ts`, which builds WE's bag.
 * A profile member whose group, kind or `ambient` disagreed with the bag would promise a second host
 * one grant while WE enforced another, so every member must match — classified where
 * `PROFILE_HOMES` says WE keeps it.
 */
import { CAPABILITY_PROFILES, HOST_ONLY_EQUIVALENTS, PROFILE_MEMBERS } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_GROUPS,
  PROFILE_HOMES,
  profileHome,
  TEMPLATE_SURFACE,
} from '../src/shared/registries/templateSurface';

const classified = (path: string) => {
  const [namespace, member] = path.split('.');
  const home = profileHome(namespace, member);
  return home ? TEMPLATE_SURFACE[home]?.[member] : undefined;
};

describe('capability profiles against the template surface', () => {
  it('home every profile member in exactly one store, and nothing that is not one', () => {
    expect(Object.keys(PROFILE_HOMES)).toEqual(CAPABILITY_PROFILES.map((p) => p.namespace));
    const homed = Object.entries(PROFILE_HOMES).flatMap(([namespace, stores]) =>
      Object.values(stores).flatMap((members) => members.map((member) => `${namespace}.${member}`)),
    );
    expect(new Set(homed).size).toBe(homed.length);
    expect([...homed].sort()).toEqual([...PROFILE_MEMBERS.keys()].sort());
  });

  it('classify every profile member as the surface does', () => {
    for (const profile of CAPABILITY_PROFILES) {
      for (const member of profile.members) {
        const spec = classified(member.path);
        expect(spec, `${member.path} is not classified`).toBeDefined();
        expect(spec, `${member.path} is host wiring`).not.toBe('wiring');
        if (!spec || spec === 'wiring') continue;
        expect(member.group in CAPABILITY_GROUPS, `${member.path}: unknown group ${member.group}`).toBe(true);
        expect({ group: member.group, kind: member.kind, ambient: member.ambient ?? false }, member.path).toEqual({
          group: spec.group,
          kind: spec.kind,
          ambient: spec.ambient ?? false,
        });
      }
    }
  });

  it('give an action no more arguments than a template may pass', () => {
    for (const { member } of PROFILE_MEMBERS.values()) {
      const spec = classified(member.path);
      if (member.kind !== 'action' || !spec || spec === 'wiring' || spec.arity === undefined) continue;
      expect(member.args?.length, member.path).toBeLessThanOrEqual(spec.arity);
    }
  });

  it('offer neutral equivalents only for members the surface still has under their store', () => {
    for (const path of Object.keys(HOST_ONLY_EQUIVALENTS)) {
      const [store, member] = path.split('.');
      const spec = TEMPLATE_SURFACE[store]?.[member];
      expect(spec, `${path} is not classified`).toBeDefined();
      expect(spec, `${path} is host wiring`).not.toBe('wiring');
      expect(
        Object.values(PROFILE_HOMES).some((stores) => stores[store]?.includes(member)),
        `${path} is a profile member`,
      ).toBe(false);
    }
  });
});
