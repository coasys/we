/**
 * Identity ids for writes made outside an operation. Apart from `ids.ts`, which the core manifest
 * imports, because this reads the registry the core manifest is registered into.
 */
import { identityDomainOf } from '../entityRegistry';
import { deriveIdentityId, identityText } from './ids';
import { identityOf } from './registry';

/**
 * The id `entity`'s record with these fields takes when the entity's records are keyed by identity
 * (see `identityOf`), within the dataset's identity domain; undefined when they are not, or when an
 * identity field has no value, and the record takes whatever id its write gives it. For a write made
 * outside an operation that must name the record an operation's create would: a space's starter
 * vocabulary, and a role. `domain` is given by a caller that already holds it (a space's starter,
 * written just after the space's record); otherwise the domain the host registered says.
 */
export async function identityIdOf(
  entity: string,
  fields: Record<string, unknown>,
  dataset: unknown,
  domain?: string | null,
): Promise<string | undefined> {
  const identity = identityOf(entity);
  if (!identity) return undefined;
  const pairs: [string, string][] = [];
  for (const field of identity) {
    const text = identityText(fields[field]);
    if (text === undefined) return undefined;
    pairs.push([field, text]);
  }
  return deriveIdentityId(entity, pairs, domain !== undefined ? domain : await identityDomainOf(dataset));
}
