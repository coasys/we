/**
 * Who is on something, and what a write about it means.
 *
 * An `Involvement` is one person's part in one record; an `InvolvementType` is the community's word
 * for a kind of part. The entities carry the reasoning for why this is a record at all and why it
 * sits beside `WeNode.participants` rather than replacing it — see `@we/entities`' manifest modules.
 * The writes are `core.setInvolvement` and `core.respond` (declared in `@we/entities`, where their
 * rules are written down); this file is what the host adds around them — the order presses are
 * written in, the answer drawn before it is stored, and how a refusal reaches the person. The rules:
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
 *
 * Framework-neutral, per `CONVENTIONS.md`: which dataset, who is asking, the vocabulary and how a
 * failure reaches a person all arrive as `InvolvementDeps`.
 */
import { type DatasetProxy, type InvolvementSemantic, isOperationError, runOperation } from '@we/entities';

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
 * which is the only order that means anything across communities. Records sharing a slug collapse to
 * the earliest, since to every involvement holding that slug they are one kind.
 */
export function resolveInvolvementTypes(own: readonly InvolvementTypeView[]): InvolvementTypeView[] {
  const bySlug = new Map<string, InvolvementTypeView>();
  for (const kind of own) if (kind.slug && !bySlug.has(kind.slug)) bySlug.set(kind.slug, kind);
  return [...bySlug.values()].sort((a, b) => rank(a.semantic) - rank(b.semantic));
}

/** A relation read back as an id, whichever shape the backend handed it over in. */
export function relationId(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return relationId(value[0]);
  if (value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string') {
    return (value as { id: string }).id;
  }
  return '';
}

/** What the involvement actions need from the app around them. */
export interface InvolvementDeps {
  /** The dataset a write means — the space on screen. */
  dataset: () => DatasetProxy | undefined;
  /** The DID of the agent asking. */
  me: () => string | undefined;
  /** The kinds this space uses, withdrawn ones included — a write about one somebody already holds must still resolve. */
  types: () => readonly InvolvementTypeView[];
  /** How a refusal or a failure reaches the person who caused it. */
  notify: (message: string) => void;
  /**
   * Show an involvement before it is stored — `on` says whether the pair should read as present.
   *
   * The same split `BoardDeps.hold` makes and for its reason: the write resolves before the
   * subscription carries it back, so releasing on success would put the old answer back for the
   * rest of the round trip. What releases a successful one is the data arriving; see
   * `involvementOptimism`.
   */
  hold?: (nodeId: string, agent: string, kind: string, on: boolean) => void;
  /** Withdraw a held involvement — the write failed, so what is on screen is a lie. */
  release?: (nodeId: string, agent: string, kind: string) => void;
  /** A write behind a hold has returned — see `involvementOptimism`'s "Nothing settles while a write is still going". */
  done?: (nodeId: string, agent: string, kind: string) => void;
}

export interface InvolvementActions {
  setInvolvement: (nodeId: string, agent: string, kind: string, on: boolean) => Promise<void>;
  respond: (nodeId: string, kind: string) => Promise<void>;
}

export function createInvolvementActions(deps: InvolvementDeps): InvolvementActions {
  const { dataset, me, types, notify, hold, release, done } = deps;

  /*
    One write at a time per pair, in the order they were pressed.

    On, off and on again in quick succession were three writes racing: the "off" looked for the row
    before the "on" had created it, found nothing to delete, and returned — then the "on" landed, and
    the data said on while the screen had been told off. Chained, each write reads what the one
    before it left.
  */
  const queues = new Map<string, Promise<void>>();
  const inOrder = (queue: string, write: () => Promise<void>): Promise<void> => {
    const next = (queues.get(queue) ?? Promise.resolve()).then(write, write);
    queues.set(queue, next);
    void next.finally(() => {
      if (queues.get(queue) === next) queues.delete(queue);
    });
    return next;
  };

  /** A refusal the operation names is said as it is; anything else is a failure to save. */
  const say = (error: unknown, fallback: string) =>
    notify(
      isOperationError(error) && error.class === 'precondition' && error.code !== 'refused' ? error.message : fallback,
    );

  const answerSlugs = () =>
    types()
      .filter((t) => t.reflexive)
      .map((t) => t.slug);

  /**
   * Put somebody on a record, or take them off — `core.setInvolvement`.
   *
   * `on` rather than a toggle, so the write is idempotent: a menu passes the state it wants, which is
   * the opposite of the tick it is showing, and pressing twice on a slow connection cannot turn one
   * assignment into none. The operation routes a reflexive kind to `core.respond`, and refuses it for
   * anybody but the agent it is about; what is held on screen meanwhile follows the same split.
   */
  async function setInvolvement(nodeId: string, agent: string, kind: string, on: boolean): Promise<void> {
    const p = dataset();
    const self = me();
    if (!p || !self || !nodeId || !agent || !kind) return;
    const answer = types().find((t) => t.slug === kind)?.reflexive === true && agent === self;
    const held = answer ? answerSlugs() : [kind];
    for (const slug of held) hold?.(nodeId, agent, slug, slug === kind ? on : false);
    // An answer shares its queue with `respond`, since both rewrite the same agent's one answer.
    const queue = answer ? `${nodeId}\u0000${self}\u0000answer` : `${nodeId}\u0000${agent}\u0000${kind}`;
    await inOrder(queue, async () => {
      try {
        await runOperation('core.setInvolvement', { node: nodeId, agent, kind, on }, { dataset: p, invoker: self });
        for (const slug of held) done?.(nodeId, agent, slug);
      } catch (error) {
        for (const slug of held) release?.(nodeId, agent, slug);
        console.error('SpaceStore: could not update who is on that', error);
        say(error, 'Could not save that');
      }
    });
  }

  /**
   * Give this agent's own answer to a record — going, maybe, not going — or withdraw it with `''`:
   * `core.respond`, which replaces any answer they gave before in the same write.
   */
  async function respond(nodeId: string, kind: string): Promise<void> {
    const p = dataset();
    const self = me();
    if (!p || !nodeId || !self) return;
    const answers = answerSlugs();
    const held = answers.includes(kind) || !kind ? answers : [];
    for (const slug of held) hold?.(nodeId, self, slug, slug === kind);
    await inOrder(`${nodeId}\u0000${self}\u0000answer`, async () => {
      try {
        await runOperation('core.respond', { node: nodeId, kind: kind || null }, { dataset: p, invoker: self });
        for (const slug of held) done?.(nodeId, self, slug);
      } catch (error) {
        for (const slug of held) release?.(nodeId, self, slug);
        console.error('SpaceStore: could not save that answer', error);
        say(error, 'Could not save your answer');
      }
    });
  }

  return { setInvolvement, respond };
}
