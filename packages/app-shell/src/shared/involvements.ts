/**
 * Who is on something, and what a write about it means.
 *
 * An `Involvement` is one person's part in one record; an `InvolvementType` is the community's word
 * for a kind of part. The entities carry the reasoning for why this is a record at all and why it
 * sits beside `WeNode.participants` rather than replacing it — see `@we/entities`' manifest modules.
 * The writes are `core.setInvolvement` and `core.respond` (declared in `@we/entities`, where their
 * rules are written down), invoked straight from a template; the host draws them before they land and
 * queues them by their `serial` key as it does every operation. This file is how a screen reads the
 * vocabulary. The rules the operations keep:
 *
 * - **Two authorships.** A kind that is not `reflexive` is something one member says about another
 *   — assigning a task — and anybody may write it about anybody. A reflexive kind is an agent's own
 *   answer, and only that agent may give it. Refused here rather than trusted to a template, because
 *   a space template arrives from a stranger and "mark everyone as going" is one expression away.
 * - **One answer.** An agent gives one reflexive answer to a record: going, maybe or not going, never
 *   two. Changing it is one transaction, so no reader sees somebody both going and not.
 * - **Non-reflexive kinds stack.** A task can have an assignee and a reviewer, and they can be the
 *   same person. Each is its own record and its own toggle.
 *
 * ## The vocabulary is the space's records
 *
 * The kinds a space has are its `InvolvementType` records, which a new space's starter writes. There
 * are no defaults standing in for records, under `TaskState`'s rule.
 *
 * ## Conflict-freedom, and where it stops
 *
 * Every write here names its own agent and its own pair, so two members assigning two different
 * people at once cannot drop each other — there is no list being read and written back. Two members
 * toggling the *same* person on the *same* task at the same instant can leave that one toggle in
 * either state, or as a duplicate record; a duplicate reads as one involvement (see
 * `sources/involvement.ts`) and the next write removes both. That is the one race, it is between two
 * people doing the same thing, and either answer is one somebody chose.
 */
import type { InvolvementSemantic } from '@we/entities';

/** What `InvolvementType.semantic` may hold, in the reading order a list uses. */
export const INVOLVEMENT_SEMANTICS: readonly InvolvementSemantic[] = [
  'responsible',
  'reviewing',
  'committed',
  'interested',
  'declined',
];

/**
 * A kind of part, as a screen reads it — one `InvolvementType` record.
 *
 * `appliesTo` is split into entity names here so an expression can ask `'TaskBlock' in
 * kind.appliesTo`; empty means every kind of record.
 */
export interface InvolvementTypeView {
  id: string;
  name: string;
  /** What `Involvement.kind` holds. */
  slug: string;
  semantic: InvolvementSemantic;
  reflexive: boolean;
  appliesTo: string[];
  icon: string;
  color: string;
  retired: boolean;
}

/** `appliesTo` as stored — comma-separated entity names — read as a list. */
export function parseAppliesTo(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  return raw
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
}

const rank = (semantic: string) => {
  const at = INVOLVEMENT_SEMANTICS.indexOf(semantic as InvolvementSemantic);
  return at === -1 ? INVOLVEMENT_SEMANTICS.length : at;
};

/**
 * The kinds this space uses, as screens read them.
 *
 * Ordered by semantic — who is doing it, who is checking it, who is coming, who might, who will not —
 * which is the only order that means anything across communities. A slug names one record, since a
 * kind's id derives from its slug; a record without a slug names nothing an involvement could hold.
 */
export function resolveInvolvementTypes(own: readonly InvolvementTypeView[]): InvolvementTypeView[] {
  return own.filter((kind) => kind.slug).sort((a, b) => rank(a.semantic) - rank(b.semantic));
}

/** A to-one relation's id: the id itself, or the record when the read included it. */
export function relationId(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return '';
}
