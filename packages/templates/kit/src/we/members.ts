/**
 * The people of the space on screen, as an expression: each member's profile, in the order the
 * space lists them.
 *
 * Two profile members joined — `spaceStore.memberDids` (who is here) and `profileStore.profiles`
 * (who people are) — so it reads the same on any host that provides the identity profile. A member
 * whose profile has not arrived yet is left out until it does, rather than drawn as a bare DID.
 *
 * A lookup of one person by DID does not need this: `find(profileStore.profiles, { did })` answers
 * for anybody, member or not.
 */
export const MEMBERS = 'spaceStore.memberDids.map(d, find(profileStore.profiles, { did: d })).filter(m, m)';
