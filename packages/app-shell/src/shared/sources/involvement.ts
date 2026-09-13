/**
 * Who is on each record, worked out from the raw involvement rows — the read side of `involvements.ts`.
 *
 * ## Why a host function
 *
 * Every question a card or a row asks — who is assigned, who is reviewing, am I going, how many said
 * maybe — is a join of three things an expression handles badly: a list of rows keyed by a relation
 * that may arrive as a string or a one-element list, the community's vocabulary to learn what each
 * slug *means*, and a rule about duplicates. Written as comprehensions it would be the same join
 * inlined at every call site, which is the shape `arrangedBoard` was moved out of the expression
 * layer to escape.
 *
 * ## What it decides
 *
 * - **By semantic, not by slug.** `responsible` answers "who is doing this" whatever this community
 *   calls the kind, so a board keeps drawing assignees after somebody renames "Assigned" to "Owner"
 *   or adds "Shepherd" beside it. An unknown slug reads as `responsible` for a non-answer and is
 *   kept, because a person's part in the work shown oddly beats a person silently missing from it.
 * - **Duplicates collapse.** Two members pressing the same toggle at the same instant can leave two
 *   records for one pair; to every reader here they are one involvement.
 * - **`dids` leaves out anybody who declined.** It is what a people filter matches on, and somebody
 *   who said they are not going is exactly the person a "who is coming" filter must not surface the
 *   event for.
 *
 * ## Pending writes
 *
 * `pending` is applied to the rows before anything else, so a toggle shows on the click rather than
 * a round trip later — the same arrangement `arrangedBoard` has with `boardOptimism`, for the same
 * reason. See `involvementOptimism`.
 */
import type { InvolvementSemantic } from '@we/entities';

import { relationId } from '../involvements';

export interface InvolvementRowInput {
  id?: string;
  node?: unknown;
  agent?: string;
  kind?: string;
}

export interface InvolvementKindInput {
  slug: string;
  name?: string;
  semantic?: string;
  reflexive?: boolean;
  icon?: string;
  color?: string;
}

/** A written-but-not-yet-seen involvement: whether this pair should read as present. */
export interface PendingInvolvement {
  node: string;
  agent: string;
  kind: string;
  on: boolean;
}

export interface InvolvementOptions {
  rows?: InvolvementRowInput[] | null;
  /** `spaceStore.involvementTypes` — withdrawn kinds included, since somebody may still hold one. */
  types?: InvolvementKindInput[] | null;
  /** The viewer's DID, for `answers`, and to lead `dids` when they are in it. */
  me?: string | null;
  /**
   * Only these records count towards `dids` — the people on a board's cards, or a month's events.
   * `byNode` still answers for every record. Omit for everyone on anything.
   */
  nodes?: string[] | null;
  pending?: readonly PendingInvolvement[] | null;
}

/** One person's part in one record, resolved against the vocabulary. */
export interface PersonOn {
  did: string;
  kind: string;
  name: string;
  semantic: string;
  reflexive: boolean;
  icon: string;
  color: string;
  /**
   * The avatar tone a face is ringed in for this part — `''` for none. See {@link TONE_BY_SEMANTIC}.
   */
  tone: string;
}

/**
 * Which ring a face wears for the part it has, by meaning — one table, so a card, a picker and a
 * roster ring the same person the same way.
 *
 * Only reviewing is marked. The assignee is who a card is *about*, and plain is how the eye reads
 * "this person"; a reviewer beside them is the one worth telling apart at a glance, and a coloured
 * ring does that without a second glyph. Danger's red because a review waiting on somebody is the
 * thing on a board most likely to be holding work up.
 */
export const TONE_BY_SEMANTIC: Record<string, string> = { reviewing: 'danger' };

export interface NodeInvolvement {
  people: PersonOn[];
  /** Everyone on it who has not declined — what a people filter matches. */
  dids: string[];
  responsible: string[];
  reviewing: string[];
  committed: string[];
  interested: string[];
  declined: string[];
  /**
   * Every `did|kind` pair present, for a menu's tick: `` `${m.did}|assignee` in view.byNode[id].pairs ``.
   * A flat list because `in` tests list membership and an expression cannot index a map by two keys.
   */
  pairs: string[];
}

export interface InvolvementView {
  byNode: Record<string, NodeInvolvement>;
  /** The viewer's own reflexive answer to each record — `going`, `maybe`, … — or absent. */
  answers: Record<string, string>;
  /**
   * Everyone involved in anything here — or in `nodes`, when given — declined excluded. In the order
   * they first appear, except that the viewer leads when they are in it.
   */
  dids: string[];
}

const SEMANTIC_KEYS: readonly InvolvementSemantic[] = [
  'responsible',
  'reviewing',
  'committed',
  'interested',
  'declined',
];

const asRows = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Held writes applied to observed rows: an `on` adds the pair if absent, an `off` removes every copy. */
export function applyPendingInvolvements(
  rows: readonly InvolvementRowInput[],
  pending: readonly PendingInvolvement[] | null | undefined,
): InvolvementRowInput[] {
  if (!pending?.length) return [...rows];
  const key = (node: string, agent: string, kind: string) => `${node}\u0000${agent}\u0000${kind}`;
  const held = new Map(pending.map((p) => [key(p.node, p.agent, p.kind), p]));
  const out = rows.filter((row) => {
    const entry = held.get(key(relationId(row.node), row.agent ?? '', row.kind ?? ''));
    return !entry || entry.on;
  });
  const present = new Set(out.map((row) => key(relationId(row.node), row.agent ?? '', row.kind ?? '')));
  for (const entry of pending) {
    const k = key(entry.node, entry.agent, entry.kind);
    if (entry.on && !present.has(k)) {
      out.push({ node: entry.node, agent: entry.agent, kind: entry.kind });
      present.add(k);
    }
  }
  return out;
}

export function involvement(options: InvolvementOptions | null | undefined): InvolvementView {
  const types = asRows<InvolvementKindInput>(options?.types).filter((t) => t && t.slug);
  const bySlug = new Map(types.map((t) => [t.slug, t]));
  const rows = applyPendingInvolvements(
    asRows<InvolvementRowInput>(options?.rows).filter((r) => r && typeof r === 'object'),
    options?.pending,
  );
  const me = options?.me ?? '';
  const counted = Array.isArray(options?.nodes) ? new Set(options.nodes) : null;

  const byNode: Record<string, NodeInvolvement> = {};
  const answers: Record<string, string> = {};
  const everyone: string[] = [];
  const seenEveryone = new Set<string>();

  for (const row of rows) {
    const node = relationId(row.node);
    const did = row.agent ?? '';
    const kind = row.kind ?? '';
    if (!node || !did || !kind) continue;
    const entry = (byNode[node] ??= {
      people: [],
      dids: [],
      responsible: [],
      reviewing: [],
      committed: [],
      interested: [],
      declined: [],
      pairs: [],
    });
    const pair = `${did}|${kind}`;
    if (entry.pairs.includes(pair)) continue;
    entry.pairs.push(pair);

    const type = bySlug.get(kind);
    const semantic = (SEMANTIC_KEYS as readonly string[]).includes(type?.semantic ?? '')
      ? (type!.semantic as InvolvementSemantic)
      : 'responsible';
    entry.people.push({
      did,
      kind,
      name: type?.name || kind,
      semantic,
      reflexive: Boolean(type?.reflexive),
      icon: type?.icon ?? '',
      color: type?.color ?? '',
      tone: TONE_BY_SEMANTIC[semantic] ?? '',
    });
    if (!entry[semantic].includes(did)) entry[semantic].push(did);
    if (semantic !== 'declined') {
      if (!entry.dids.includes(did)) entry.dids.push(did);
      if ((!counted || counted.has(node)) && !seenEveryone.has(did)) {
        seenEveryone.add(did);
        everyone.push(did);
      }
    }
    if (did === me && type?.reflexive) answers[node] = kind;
  }

  // People in reading order within each record — who is doing it before who is coming — so a stack
  // of faces leads with the ones the surface is most likely about.
  const rank = (semantic: string) => SEMANTIC_KEYS.indexOf(semantic as InvolvementSemantic);
  for (const entry of Object.values(byNode)) entry.people.sort((a, b) => rank(a.semantic) - rank(b.semantic));

  const mine = everyone.indexOf(me);
  if (mine > 0) everyone.unshift(...everyone.splice(mine, 1));
  return { byNode, answers, dids: everyone };
}
