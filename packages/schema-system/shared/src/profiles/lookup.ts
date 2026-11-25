import { CAPABILITY_PROFILES } from './profiles';
import type { CapabilityProfile, ProfileMember } from './types';

/**
 * Namespaces a template names that are neutral surfaces rather than host members: records, declared
 * operations and the module stores are specified on their own and every host provides them, so a
 * reference to one is never WE-host-only.
 */
export const NEUTRAL_NAMESPACES: ReadonlySet<string> = new Set(['record', 'ops', 'modules']);

/** Every profile member by path, with the profile that holds it. */
export const PROFILE_MEMBERS: ReadonlyMap<string, { profile: CapabilityProfile; member: ProfileMember }> = new Map(
  CAPABILITY_PROFILES.flatMap((profile) => profile.members.map((member) => [member.path, { profile, member }])),
);

/** The profile holding `store.member`, if any. Only the first two segments of a deeper path count. */
export function profileOf(path: string): CapabilityProfile | undefined {
  const [store, member] = path.split('.');
  return PROFILE_MEMBERS.get(`${store}.${member}`)?.profile;
}
