/**
 * The id derivation as vectors, standalone (`execution.md`, "Ids" and "Identity ids"): an invocation
 * id and a step path, or an entity, its identity and the dataset's shared id, to the text framed, and
 * the `urn:uuid` it gives.
 *
 * `framed` is the input to SHA-256 as text (it is hashed as its UTF-8 bytes), so an implementation
 * whose id disagrees can see whether its framing or its hashing is the part that differs.
 */
import { deriveIdentityId, deriveRecordId } from '@we/entities';

export type IdCase =
  | { id: string; note: string; kind: 'invocation'; invocationId: string; path: string[] }
  | {
      id: string;
      note: string;
      kind: 'identity';
      entity: string;
      identity: [field: string, value: string][];
      sharedId?: string;
    };

const INV = '00000000-0000-4000-8000-000000000001';

export const ID_CASES: IdCase[] = [
  {
    id: 'ids.invocation-first-step',
    note: 'the board in create-and-link',
    kind: 'invocation',
    invocationId: INV,
    path: ['0'],
  },
  {
    id: 'ids.invocation-loop-key',
    note: 'the first column in create-and-link: a forEach contributes its key, never its position',
    kind: 'invocation',
    invocationId: INV,
    path: ['1', 'k=todo', '0'],
  },
  {
    id: 'ids.invocation-other',
    note: 'another invocation id, the same path shape: another id',
    kind: 'invocation',
    invocationId: '3f2b8c1e-0000-4000-8000-000000000001',
    path: ['0', 'k=todo', '0'],
  },
  {
    id: 'ids.invocation-utf8',
    note: 'a key with a character of two UTF-8 bytes is framed by its byte length',
    kind: 'invocation',
    invocationId: 'inv',
    path: ['0', 'k=café', '1'],
  },
  {
    id: 'ids.invocation-astral',
    note: 'a key outside the Basic Multilingual Plane: four bytes, framed by its byte length',
    kind: 'invocation',
    invocationId: 'inv',
    path: ['0', 'k=😀'],
  },
  {
    id: 'ids.invocation-call',
    note: 'a record made inside a call: the call contributes c= and the callee’s qualified name',
    kind: 'invocation',
    invocationId: INV,
    path: ['0', 'c=conformance.note', '0'],
  },
  {
    id: 'ids.invocation-framing-in-key',
    note: 'a key holding the framing’s own characters cannot make two paths read alike',
    kind: 'invocation',
    invocationId: 'inv',
    path: ['0', 'k=a1:0'],
  },
  {
    id: 'ids.invocation-split-key',
    note: 'the same characters split into two segments: framed differently, another id',
    kind: 'invocation',
    invocationId: 'inv',
    path: ['0', 'k=a', '0'],
  },
  {
    id: 'ids.invocation-empty-path',
    note: 'an empty path is the invocation id alone',
    kind: 'invocation',
    invocationId: 'inv',
    path: [],
  },
  {
    id: 'ids.identity-slug',
    note: 'the state in identity-id: a task state by its slug, in a dataset with no shared id',
    kind: 'identity',
    entity: 'TaskState',
    identity: [['slug', 'blocked']],
  },
  {
    id: 'ids.identity-shared',
    note: 'the state in identity-id-shared: the same identity within a dataset’s shared id',
    kind: 'identity',
    entity: 'TaskState',
    identity: [['slug', 'blocked']],
    sharedId: 'QmSpaceA',
  },
  {
    id: 'ids.identity-other-dataset',
    note: 'the same identity in another shared dataset: another record',
    kind: 'identity',
    entity: 'TaskState',
    identity: [['slug', 'blocked']],
    sharedId: 'QmSpaceB',
  },
  {
    id: 'ids.identity-role',
    note: 'a role by its slug',
    kind: 'identity',
    entity: 'Role',
    identity: [['slug', 'admin']],
  },
  {
    id: 'ids.identity-two-fields',
    note: 'an identity of two fields, in the order the identity lists them',
    kind: 'identity',
    entity: 'Vote',
    identity: [
      ['poll', 'urn:example:p'],
      ['voter', 'did:example:ann'],
    ],
  },
  {
    id: 'ids.identity-two-fields-reversed',
    note: 'the same fields listed the other way round: another id, since the order is part of the identity',
    kind: 'identity',
    entity: 'Vote',
    identity: [
      ['voter', 'did:example:ann'],
      ['poll', 'urn:example:p'],
    ],
  },
  {
    id: 'ids.identity-number-utf8',
    note: 'a number as its shortest decimal, and a value with a two-byte character',
    kind: 'identity',
    entity: 'Seat',
    identity: [
      ['row', 'café'],
      ['n', '1.5'],
    ],
  },
  {
    id: 'ids.identity-boolean',
    note: 'a boolean as true or false',
    kind: 'identity',
    entity: 'Flag',
    identity: [['on', 'true']],
  },
  {
    id: 'ids.identity-spells-invocation',
    note: 'an identity whose segments spell an invocation’s: the empty domain keeps the two apart',
    kind: 'identity',
    entity: 'inv',
    identity: [['0', 'k=a']],
  },
];

const encoder = new TextEncoder();
const frame = (parts: readonly string[]) => parts.map((part) => `${encoder.encode(part).length}:${part}`).join('');

/** The segments a case frames, in order. */
export function segmentsOf(c: IdCase): string[] {
  if (c.kind === 'invocation') return [c.invocationId, ...c.path];
  return ['', ...(c.sharedId ? [`d=${c.sharedId}`] : []), c.entity, ...c.identity.flat()];
}

/** What the reference derives for a case. */
export async function derivedId(c: IdCase): Promise<string> {
  return c.kind === 'invocation'
    ? deriveRecordId(c.invocationId, c.path)
    : deriveIdentityId(c.entity, c.identity, c.sharedId ?? null);
}

/** `ids.json`: per case its inputs, the text framed, and the id. */
export async function recordIds() {
  const cases = [];
  for (const c of ID_CASES) cases.push({ ...c, framed: frame(segmentsOf(c)), result: await derivedId(c) });
  return { version: 1, cases };
}
