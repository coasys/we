/**
 * The capability profiles, held to the template surface.
 *
 * The profiles are written down twice on purpose: as language-neutral data in `@we/schema-shared`,
 * which another host reads, and as the classification in `templateSurface.ts`, which builds WE's bag.
 * A profile member whose group, kind or `ambient` disagreed with the bag would promise a second host
 * one grant while WE enforced another, so every member must match.
 */
import { CAPABILITY_PROFILES, HOST_ONLY_EQUIVALENTS, PROFILE_MEMBERS } from '@we/schema-shared';
import { describe, expect, it } from 'vitest';

import { CAPABILITY_GROUPS, TEMPLATE_SURFACE } from '../src/shared/registries/templateSurface';

const classified = (path: string) => {
  const [store, member] = path.split('.');
  return TEMPLATE_SURFACE[store]?.[member];
};

describe('capability profiles against the template surface', () => {
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

  it('offer neutral equivalents only for members the surface still has', () => {
    for (const path of Object.keys(HOST_ONLY_EQUIVALENTS)) {
      const spec = classified(path);
      expect(spec, `${path} is not classified`).toBeDefined();
      expect(spec, `${path} is host wiring`).not.toBe('wiring');
    }
  });
});
