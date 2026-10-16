import type { parseAddress } from '@we/graph-protocol';

type Address = ReturnType<typeof parseAddress>;

/**
 * Whether a node stands for a stored record, so a payload may name one.
 *
 * Every record's node has an entity address, but not every entity address is a record: a map of a
 * vocabulary draws each model as a node (`$schema`) and the way into its instances as another
 * (`$instances`), and those types name no entity. Reported as records, a click on one asked the
 * inspector for a model called "$schema". A real entity's name never starts with `$`.
 */
export function isRecordAddress(at: Address | undefined): at is NonNullable<Address> {
  return at?.kind === 'entity' && !(at.type ?? '').startsWith('$');
}
