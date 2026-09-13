/**
 * Who is on something, and what a write about it means.
 *
 * An `Involvement` is one person's part in one record; an `InvolvementType` is the community's word
 * for a kind of part. The entities carry the reasoning for why this is a record at all and why it
 * sits beside `WeNode.participants` rather than replacing it — see `@we/entities`' manifest modules.
 * This file is what those two decisions cost at write time:
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
 * ## The vocabulary is virtual until somebody acts on it
 *
 * `DEFAULT_INVOLVEMENT_TYPES` stand in until a space writes its own, under `TaskState`'s rule and for
 * its reason: unset means these, not none. A record with a default's slug *is* that default adopted.
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
import {
  type DatasetProxy,
  DEFAULT_INVOLVEMENT_TYPES,
  Involvement,
  type InvolvementSemantic,
  runEntityTransaction,
} from '@we/entities';

/** What `InvolvementType.semantic` may hold, in the reading order a list uses. */
export const INVOLVEMENT_SEMANTICS: readonly InvolvementSemantic[] = [
  'responsible',
  'reviewing',
  'committed',
  'interested',
  'declined',
];

/**
 * A kind of part, as a screen reads it.
 *
 * `defined` is false for a default the space has never written down — a virtual kind, which becomes
 * a record the first time somebody edits or withdraws it. `appliesTo` is split into entity names
 * here so an expression can ask `'TaskBlock' in kind.appliesTo`; empty means every kind of record.
 */
export interface InvolvementTypeView {
  /** Empty for a default the space has not written down. */
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
  defined: boolean;
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
 * The kinds this space uses: its own records, and beneath them every default nobody has overridden.
 *
 * Ordered by semantic — who is doing it, who is checking it, who is coming, who might, who will not —
 * which is the only order that means anything across communities. Records sharing a slug collapse to
 * the earliest, since to every involvement holding that slug they are one kind.
 */
export function resolveInvolvementTypes(own: readonly InvolvementTypeView[]): InvolvementTypeView[] {
  const bySlug = new Map<string, InvolvementTypeView>();
  for (const kind of own) if (kind.slug && !bySlug.has(kind.slug)) bySlug.set(kind.slug, kind);
  const virtual: InvolvementTypeView[] = DEFAULT_INVOLVEMENT_TYPES.filter((d) => !bySlug.has(d.slug)).map((d) => ({
    id: '',
    name: d.name,
    slug: d.slug,
    semantic: d.semantic,
    reflexive: d.reflexive,
    appliesTo: parseAppliesTo(d.appliesTo),
    icon: d.icon,
    color: d.color,
    retired: false,
    defined: false,
  }));
  return [...bySlug.values(), ...virtual].sort((a, b) => rank(a.semantic) - rank(b.semantic));
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

  /** Every involvement this agent holds on this node — one query on the agent, narrowed by node here. */
  async function heldBy(p: DatasetProxy, nodeId: string, agent: string): Promise<Involvement[]> {
    const rows = (await Involvement.findAll(p, { where: { agent } })) as Involvement[];
    return rows.filter((row) => relationId(row.node) === nodeId);
  }

  /**
   * Put somebody on a record, or take them off — a kind one member says about another.
   *
   * `on` rather than a toggle, so the write is idempotent: a menu passes the state it wants, which is
   * the opposite of the tick it is showing, and pressing twice on a slow connection cannot turn one
   * assignment into none. A reflexive kind is routed to `respond`, and refused outright for anybody
   * but the agent it is about.
   */
  async function setInvolvement(nodeId: string, agent: string, kind: string, on: boolean): Promise<void> {
    const p = dataset();
    const self = me();
    if (!p || !nodeId || !agent || !kind) return;
    const type = types().find((t) => t.slug === kind);
    if (!type) {
      notify('That is not a kind of involvement this space has');
      return;
    }
    if (type.reflexive) {
      if (agent !== self) {
        notify(`Only they can say whether they are ${type.name.toLowerCase()}`);
        return;
      }
      await respond(nodeId, on ? kind : '');
      return;
    }
    hold?.(nodeId, agent, kind, on);
    await inOrder(`${nodeId}\u0000${agent}\u0000${kind}`, async () => {
      try {
        const matching = (await heldBy(p, nodeId, agent)).filter((row) => row.kind === kind);
        if (on && !matching.length) {
          await Involvement.create(p, { agent, kind, node: [nodeId] } as never);
        } else if (!on && matching.length) {
          // Every copy, not the first: a duplicate left by two members pressing at once must not
          // survive the person who meant to remove it.
          await runEntityTransaction(p, async (tx) => {
            for (const row of matching) await row.delete(tx.batchId);
          });
        }
        done?.(nodeId, agent, kind);
      } catch (error) {
        release?.(nodeId, agent, kind);
        console.error('SpaceStore: could not update who is on that', error);
        notify('Could not save that');
      }
    });
  }

  /**
   * Give this agent's own answer to a record — going, maybe, not going — or withdraw it with `''`.
   *
   * One answer per record, so every other reflexive kind this agent holds on it goes in the same
   * transaction the new one arrives in. Non-reflexive kinds are untouched: answering an invitation
   * says nothing about whether you were assigned to it.
   */
  async function respond(nodeId: string, kind: string): Promise<void> {
    const p = dataset();
    const self = me();
    if (!p || !nodeId || !self) return;
    const answers = new Set(
      types()
        .filter((t) => t.reflexive)
        .map((t) => t.slug),
    );
    if (kind && !answers.has(kind)) {
      notify('That is not an answer anybody can give to this');
      return;
    }
    for (const slug of answers) hold?.(nodeId, self, slug, slug === kind);
    await inOrder(`${nodeId}\u0000${self}\u0000answer`, async () => {
      try {
        const held = (await heldBy(p, nodeId, self)).filter((row) => answers.has(row.kind));
        const stale = held.filter((row) => row.kind !== kind);
        const already = held.some((row) => row.kind === kind);
        if (stale.length || (!already && kind)) {
          await runEntityTransaction(p, async (tx) => {
            for (const row of stale) await row.delete(tx.batchId);
            if (kind && !already) {
              await Involvement.create(
                p,
                { agent: self, kind, node: [nodeId] } as never,
                { batchId: tx.batchId } as never,
              );
            }
          });
        }
        for (const slug of answers) done?.(nodeId, self, slug);
      } catch (error) {
        for (const slug of answers) release?.(nodeId, self, slug);
        console.error('SpaceStore: could not save that answer', error);
        notify('Could not save your answer');
      }
    });
  }

  return { setInvolvement, respond };
}
