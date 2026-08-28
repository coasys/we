/**
 * How one record names another that lives somewhere else.
 *
 * ## Why this is not a relation
 *
 * A link's target lives in the same dataset as its source — in AD4M, in the same perspective — and
 * a record's id is local to it. So a personal collection cannot *relate* to a post in a space: not
 * because the three tiers in `docs/architecture/relations.md` disagree about which to use, but
 * because none of them applies. A connection that crosses a dataset boundary is a fourth thing, and
 * it is a **value**: an address, written down.
 *
 * That is what this is, and it is worth spelling once rather than in each place that needs it. The
 * same string is what a gathered item holds, what an embed block points at, what a deep link
 * resolves, and what a `text/uri-list` drag out of WE would emit.
 *
 * ## The grammar
 *
 * ```
 * we:<datasetKey>/<Entity>/<recordId>    a record
 * we:<datasetKey>                        the space that dataset is
 * we:agent/<did>                         a person, who is in no dataset
 * ```
 *
 * - `datasetKey` is `n:<cid>` for a neighbourhood — **portable**, the same string for every agent
 *   who has joined it — or `p:<uuid>` for a personal dataset, which means something only on this
 *   agent's machine. {@link isPortableRef} is the question to ask before putting one in anything
 *   somebody else will read.
 * - `recordId` is **everything after the second slash**, because an id is itself a URI
 *   (`ad4m://obj/<uuid>`) and contains slashes. `datasetKey` and `Entity` never do, so the rule is
 *   unambiguous and nothing needs escaping.
 * - The bare dataset form matters more than it looks: a space dragged out of a sidebar has a
 *   dataset before its `Space` record has loaded, and navigation only ever needs the dataset.
 *
 * ## Neutral on purpose
 *
 * Here rather than in `@we/backend-ad4m` because an address that only one backend can write is not
 * an address. Nothing in this file knows what a perspective is.
 */

/** The scheme, with its colon. */
const SCHEME = 'we:';

/** What a parsed reference says. */
export interface RecordRef {
  /** `n:<cid>`, `p:<uuid>`, or `agent` for the agent form. */
  datasetKey: string;
  /** The model name, or `Agent`. Empty for the bare dataset form. */
  entity: string;
  /** The record id, or a DID. Empty for the bare dataset form. */
  id: string;
}

/** How a dataset is named inside a reference. */
export type DatasetKind = 'neighbourhood' | 'personal' | 'agent';

/**
 * Name a dataset for a reference.
 *
 * Prefer the CID wherever there is one: a personal key is this machine's and travels nowhere.
 */
export function datasetKey(options: { cid?: string | null; uuid?: string | null }): string {
  if (options.cid) return `n:${stripScheme(options.cid)}`;
  if (options.uuid) return `p:${options.uuid}`;
  return '';
}

/** `neighbourhood://<cid>` and `<cid>` are the same dataset; references always hold the bare form. */
function stripScheme(cid: string): string {
  return cid.replace(/^neighbourhood:\/\//, '');
}

/** What kind of thing a key names. */
export function datasetKindOf(key: string): DatasetKind | null {
  if (key === 'agent') return 'agent';
  if (key.startsWith('n:')) return 'neighbourhood';
  if (key.startsWith('p:')) return 'personal';
  return null;
}

/** The CID or uuid inside a key, without its prefix. */
export function datasetIdOf(key: string): string {
  return key.startsWith('n:') || key.startsWith('p:') ? key.slice(2) : key;
}

/** Write a reference. */
export function formatRef(ref: Partial<RecordRef> & { datasetKey: string }): string {
  if (!ref.datasetKey) return '';
  if (!ref.entity || !ref.id) return `${SCHEME}${ref.datasetKey}`;
  return `${SCHEME}${ref.datasetKey}/${ref.entity}/${ref.id}`;
}

/** A person. They belong to no dataset, so they get their own form. */
export function formatAgentRef(did: string): string {
  return did ? `${SCHEME}agent/${did}` : '';
}

/**
 * Read a reference, or `null` if the string is not one.
 *
 * Total: anything unparseable is `null` rather than a throw, because these arrive from stored data
 * and a record written by an older version must degrade to "cannot resolve this" rather than
 * taking a render down.
 */
export function parseRef(value: string | null | undefined): RecordRef | null {
  if (!value || !value.startsWith(SCHEME)) return null;
  const rest = value.slice(SCHEME.length);
  if (!rest) return null;

  const firstSlash = rest.indexOf('/');
  if (firstSlash === -1) {
    // The bare dataset form: the space that dataset is.
    return datasetKindOf(rest) ? { datasetKey: rest, entity: '', id: '' } : null;
  }

  const key = rest.slice(0, firstSlash);
  const after = rest.slice(firstSlash + 1);

  // A person: `we:agent/<did>`, and a DID has no slashes but plenty of colons.
  if (key === 'agent') return after ? { datasetKey: 'agent', entity: 'Agent', id: after } : null;
  if (!datasetKindOf(key)) return null;

  const secondSlash = after.indexOf('/');
  if (secondSlash === -1) return null;
  const entity = after.slice(0, secondSlash);
  // Everything after the second slash — an id is `ad4m://obj/<uuid>` and carries its own slashes.
  const id = after.slice(secondSlash + 1);
  return entity && id ? { datasetKey: key, entity, id } : null;
}

/**
 * Whether this reference means the same thing to somebody else.
 *
 * False for anything in a personal dataset: `p:<uuid>` is a local perspective id, so a peer handed
 * one would resolve it against a dataset of their own or not at all. Gate anything shareable on
 * this — a share that quietly includes dead addresses is worse than one that says what it dropped.
 */
export function isPortableRef(value: string): boolean {
  const ref = parseRef(value);
  if (!ref) return false;
  const kind = datasetKindOf(ref.datasetKey);
  return kind === 'neighbourhood' || kind === 'agent';
}

/** The two references name the same record. String equality, given the grammar has one spelling. */
export function sameRef(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a === b;
}
