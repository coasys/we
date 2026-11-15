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
 *   two. Changing what this device said is one transaction, so no reader sees somebody both going
 *   and not; an answer another of their computers gave is removed after it, and a reader that still
 *   finds one counts only the newest (see `respond`).
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
import { newestWritten } from '@we/components/signals';
import { type DatasetProxy, Involvement, type InvolvementSemantic, runEntityTransaction } from '@we/entities';

import { keepNewestAcrossDevices, replaceAcrossDevices } from './replaceAcrossDevices';

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
  /** The DID of the agent asking — this device, which signs every write made here. */
  me: () => string | undefined;
  /**
   * Every DID that is the agent asking (`me.dids`: this device, their other devices, their person).
   * An answer given from another of their computers is still their answer: changing it here replaces
   * it rather than adding a second, and withdrawing it withdraws that one too. Omit for this device
   * alone.
   */
  mine?: () => readonly string[] | undefined;
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
  /** This device first, then every other DID that is the same agent. */
  const selves = (self: string): string[] => [...new Set([self, ...(deps.mine?.() ?? [])])];

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
    const rows = await Involvement.findAll(p, { where: { agent } });
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
      if (!self || !selves(self).includes(agent)) {
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
          await Involvement.create(p, { agent, kind, node: [nodeId] });
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
   * One answer per record, so every other reflexive kind this device holds on it goes in the same
   * transaction the new one arrives in. Non-reflexive kinds are untouched: answering an invitation
   * says nothing about whether you were assigned to it.
   *
   * An answer my other computer gave is replaced too, but after that transaction rather than inside
   * it: deleting a record another key wrote is a write a space's policy may refuse, and a refusal
   * inside the transaction would have cost the new answer with it. A refused one stays, and readers
   * still count me once, as my newest answer — see `replaceAcrossDevices`.
   *
   * Whether there is anything to write is judged against that newest answer, the one readers show,
   * not against any answer of mine: a refused removal can leave an older "going" under a newer
   * "maybe", and pressing going again has to write, or I read maybe for good.
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
      /** What my other computers answered that this replaces — held off until each removal returns. */
      let elsewhere: Involvement[] = [];
      try {
        // Mine from any of my computers — one answer per person, not one per device.
        const mineNow = async () =>
          (await Promise.all(selves(self).map((did) => heldBy(p, nodeId, did))))
            .flat()
            .filter((row) => answers.has(row.kind));
        const held = await mineNow();
        const own = held.filter((row) => row.agent === self);
        const current = newestWritten(held);
        if (kind && current?.kind === kind) {
          // Already what I answer. This device's older rows lose to it and go; nothing is written, and
          // nothing another computer wrote is touched.
          const stale = own.filter((row) => row !== current);
          if (stale.length) {
            await runEntityTransaction(p, async (tx) => {
              for (const row of stale) await row.delete(tx.batchId);
            });
          }
          // Held on for this device, but the answer that stands may be my other computer's: then
          // there is no row here for the hold to wait for.
          const settle = current.agent === self ? done : release;
          for (const slug of answers) settle?.(nodeId, self, slug);
          return;
        }
        elsewhere = held.filter((row) => row.agent !== self);
        for (const row of elsewhere) if (row.agent) hold?.(nodeId, row.agent, row.kind, false);
        // Assigned inside the transaction, so typed past the `undefined` it starts as.
        let written = undefined as Awaited<ReturnType<typeof Involvement.create>> | undefined;
        if (own.length || kind) {
          await runEntityTransaction(p, async (tx) => {
            for (const row of own) await row.delete(tx.batchId);
            if (kind)
              written = await Involvement.create(p, { agent: self, kind, node: [nodeId] }, { batchId: tx.batchId });
          });
        }
        for (const slug of answers) done?.(nodeId, self, slug);
        const failure = 'SpaceStore: could not remove the answer from your other device';
        let refused = 0;
        if (written) {
          // Read again: what another of my computers wrote meanwhile is judged too.
          const removed = await keepNewestAcrossDevices(written, await mineNow(), failure);
          for (const row of elsewhere) {
            if (!row.agent) continue;
            // One left standing is still on the record, so what is on screen goes back to the data.
            if (removed.has(row.id)) done?.(nodeId, row.agent, row.kind);
            else release?.(nodeId, row.agent, row.kind);
          }
        } else {
          for (const row of elsewhere) {
            const left = await replaceAcrossDevices([row], failure);
            refused += left;
            if (!row.agent) continue;
            if (left) release?.(nodeId, row.agent, row.kind);
            else done?.(nodeId, row.agent, row.kind);
          }
        }
        // A new answer stands over a refused old one, since readers count my newest. A withdrawal
        // that left one standing did not happen.
        if (refused) notify('Could not withdraw the answer you gave on another device');
      } catch (error) {
        for (const slug of answers) release?.(nodeId, self, slug);
        for (const row of elsewhere) if (row.agent) release?.(nodeId, row.agent, row.kind);
        console.error('SpaceStore: could not save that answer', error);
        notify('Could not save your answer');
      }
    });
  }

  return { setInvolvement, respond };
}
