/**
 * The people of the space on screen, as an expression: each member's profile, in the order the
 * space lists them.
 *
 * Two profile members joined — `identity.memberDids` (who is here) and `identity.profiles`
 * (who people are) — so it reads the same on any host that provides the identity profile. A member
 * whose profile has not arrived yet is left out until it does, rather than drawn as a bare DID.
 *
 * A lookup of one person by DID does not need this: `find(identity.profiles, { did })` answers
 * for anybody, member or not.
 */
export const MEMBERS = 'identity.memberDids.map(d, find(identity.profiles, { did: d })).filter(m, m)';
