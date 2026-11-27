import { CAPABILITY_PROFILES } from './profiles';
import type { CapabilityProfile, ProfileMember } from './types';

/**
 * Namespaces a template names that are neutral surfaces rather than host members: records, declared
 * operations and the module stores are specified on their own and every host provides them, so a
 * reference to one is never WE-host-only.
 */
export const NEUTRAL_NAMESPACES: ReadonlySet<string> = new Set(['record', 'ops', 'modules']);

/** Every profile by the namespace its members are written under. */
export const PROFILE_NAMESPACES: ReadonlyMap<string, CapabilityProfile> = new Map(
  CAPABILITY_PROFILES.map((profile) => [profile.namespace, profile]),
);

/** Every profile member by path, with the profile that holds it. */
export const PROFILE_MEMBERS: ReadonlyMap<string, { profile: CapabilityProfile; member: ProfileMember }> = new Map(
  CAPABILITY_PROFILES.flatMap((profile) => profile.members.map((member) => [member.path, { profile, member }])),
);

/** The profile holding `namespace.member`, if any. Only the first two segments of a deeper path count. */
export function profileOf(path: string): CapabilityProfile | undefined {
  const [namespace, member] = path.split('.');
  return PROFILE_MEMBERS.get(`${namespace}.${member}`)?.profile;
}

/**
 * The profile member called `name`, whichever profile holds it — member names are unique across the
 * profiles. What a validator offers when a template names a store member that is not there because
 * it is a profile's: `routeStore.params` is `navigation.params`.
 */
export function profileMemberNamed(name: string): ProfileMember | undefined {
  for (const { member } of PROFILE_MEMBERS.values())
    if (member.path.slice(member.path.indexOf('.') + 1) === name) return member;
  return undefined;
}
