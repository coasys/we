/**
 * Who is on each record, worked out from the raw involvement rows — the read side of `involvements.ts`.
 *
 * ## Why a host function
 *
 * Every question a card or a row asks — who is assigned, who is reviewing, am I going, how many said
 * maybe — is a join of three things an expression handles badly: a list of rows keyed by a relation
 * that arrives as an id or, included, as the record, the community's vocabulary to learn what each
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
 * A toggle shows on the click rather than a round trip later because the rows already carry it: the
 * host lays an invoked operation's predicted writes over the query they come from.
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
 * ring does that without a second glyph.
 *
 * Amber, not red, and never the accent. Red is the app's word for something wrong, and a review is
 * waiting on somebody rather than broken. The accent is what *selected* is drawn in — the people
 * filter rings a chosen face in it — so a ring meaning a part in the work cannot be that colour, and
 * a hue picked for assignment would collide with the accent in whichever theme happens to be that
 * hue. A status tone does not move with a theme's accent.
 */
export const TONE_BY_SEMANTIC: Record<string, string> = { reviewing: 'warning' };

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

export function involvement(options: InvolvementOptions | null | undefined): InvolvementView {
  const types = asRows<InvolvementKindInput>(options?.types).filter((t) => t && t.slug);
  const bySlug = new Map(types.map((t) => [t.slug, t]));
  const rows = asRows<InvolvementRowInput>(options?.rows).filter((r) => r && typeof r === 'object');
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
