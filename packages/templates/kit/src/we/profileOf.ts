/**
 * The cached profile of an agent, as an expression, found by any DID that names them.
 *
 * `profileStore.profiles` holds one entry per person: its `did` is the person and its `devices` the
 * device keys seen for them. A record, an involvement, a reaction or a presence entry names the
 * device that wrote it, so `find(profileStore.profiles, { did: X })` misses a person who wrote from
 * a computer of theirs — the criterion compares one field to one value, and a device key is not the
 * entry's `did`. This is the lookup that finds them by either.
 *
 * `did` is an expression (`holder.did`, `d`), not a literal. The comprehension's variable is `who`,
 * so it does not shadow a `p` or an `m` that `did` itself names.
 */
export function profileOf(did: string): string {
  return `profileStore.profiles.find(who, who.did == ${did} || ${did} in who.devices)`;
}

/** The same test for "is this the viewer", whatever device the DID is from: `X in me.dids`. */
export function isMe(did: string): string {
  return `${did} in me.dids`;
}
