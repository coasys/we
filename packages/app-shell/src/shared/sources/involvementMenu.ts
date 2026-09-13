/**
 * The entries of a "who is on this" menu, for one record — ready for `DropdownMenu`.
 *
 * ## Why a host function
 *
 * The order is the whole design and an expression cannot produce it. A picker is read top-down by
 * somebody who has just opened it to change something about *this* record, so it leads with what is
 * already true — the people who hold each part, ticked — then the viewer, then everyone else by
 * name. That is a concatenation of three sorted lists, and the expression language has neither a sort
 * nor a way to join two lists. It is the routing table's case for a host function exactly.
 *
 * ## What it offers
 *
 * - **"Assign to me"** first, while the viewer does not already hold the record's first
 *   responsible kind: the commonest thing anybody does in a picker is take the work themselves.
 * - **A group per kind** this entity is offered and anybody may give — not the reflexive ones, which
 *   are a person's own answer and have their own control. The first group is always open; the rest
 *   start closed unless somebody already holds them, so "Reviewing" does not double the list of
 *   members for a card nobody has asked to review. Search opens them.
 * - **Every member with their face**, ringed in the tone their part wears on the card, so the picker
 *   and the card agree about who is reviewing.
 *
 * Each entry carries `kind`, and `checked` for a toggle — so one handler serves every row:
 * `spaceStore.setInvolvement(record, arg.id, arg.kind, !arg.checked)`. "Assign to me" is an action
 * with no `checked`, which that same handler reads as "on".
 *
 * Holders who have left the space are still listed, from their cached profile where there is one,
 * so a card never ticks somebody the menu cannot untick.
 */
import {
  involvement,
  type InvolvementKindInput,
  type InvolvementRowInput,
  type PendingInvolvement,
  TONE_BY_SEMANTIC,
} from './involvement';

interface Member {
  did: string;
  name?: string;
  avatar?: string;
}

interface Kind extends InvolvementKindInput {
  appliesTo?: string[];
  retired?: boolean;
}

export interface InvolvementMenuOptions {
  /** The record the menu is for. */
  node?: string | null;
  /** Its entity, to choose which kinds are offered on it — `TaskBlock`. */
  entity?: string | null;
  /** The Involvement rows, as for `involvement`. */
  rows?: InvolvementRowInput[] | null;
  /** `spaceStore.offeredInvolvementTypes`. */
  types?: Kind[] | null;
  /** `spaceStore.members`. */
  members?: Member[] | null;
  /** `profileStore.profiles`, for somebody who holds a part and is no longer a member. */
  profiles?: Member[] | null;
  /** The viewer's DID. */
  me?: string | null;
  pending?: readonly PendingInvolvement[] | null;
}

const asRows = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export function involvementMenu(options: InvolvementMenuOptions | null | undefined): unknown[] {
  const node = options?.node ?? '';
  const entity = options?.entity ?? '';
  const me = options?.me ?? '';
  if (!node) return [];

  const kinds = asRows<Kind>(options?.types).filter(
    (kind) =>
      kind &&
      kind.slug &&
      !kind.reflexive &&
      !kind.retired &&
      (!kind.appliesTo?.length || kind.appliesTo.includes(entity)),
  );
  const on = involvement({
    rows: options?.rows ?? null,
    types: options?.types ?? null,
    pending: options?.pending ?? null,
  }).byNode[node];
  const holdersOf = (slug: string) => (on?.people ?? []).filter((p) => p.kind === slug).map((p) => p.did);

  const members = new Map<string, Member>();
  for (const member of asRows<Member>(options?.members)) if (member?.did) members.set(member.did, member);
  const profiles = new Map(asRows<Member>(options?.profiles).map((p) => [p.did, p]));
  // Somebody holding a part who has since left is still somebody the menu has to be able to untick.
  for (const person of on?.people ?? []) {
    if (!members.has(person.did)) members.set(person.did, profiles.get(person.did) ?? { did: person.did });
  }

  const nameOf = (member: Member) => member.name || `${member.did.slice(0, 16)}…`;
  const byName = [...members.values()].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const groups = kinds.map((kind, index) => {
    const holders = holdersOf(kind.slug);
    const held = new Set(holders);
    const ordered = [
      ...holders.map((did) => members.get(did)!).filter(Boolean),
      ...byName.filter((m) => !held.has(m.did) && m.did === me),
      ...byName.filter((m) => !held.has(m.did) && m.did !== me),
    ];
    const tone = TONE_BY_SEMANTIC[kind.semantic ?? ''] ?? '';
    return {
      type: 'group',
      id: kind.slug,
      label: kind.name || kind.slug,
      collapsible: index > 0,
      collapsed: index > 0 && holders.length === 0,
      items: ordered.map((member) => ({
        type: 'toggle',
        id: member.did,
        kind: kind.slug,
        label: member.did === me ? `${nameOf(member)} (you)` : nameOf(member),
        checked: held.has(member.did),
        avatar: { image: member.avatar ?? '', hash: member.did, tone },
      })),
    };
  });

  const doing = kinds.find((kind) => kind.semantic === 'responsible');
  const takeIt =
    doing && me && members.has(me) && !holdersOf(doing.slug).includes(me)
      ? [{ id: me, kind: doing.slug, label: 'Assign to me', icon: 'user-circle-plus' }]
      : [];

  return [...takeIt, ...groups];
}
