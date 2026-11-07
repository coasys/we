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
 * - **The person the conversation named**, first, when `said` is a name — what an extraction pass
 *   writes into `TaskBlock.assignee`, since a model cannot know a DID — that matches exactly one
 *   member, and nobody is doing the work yet. Exactly one: two Jameses is a guess, and a guess about
 *   who owns work is the wrong thing to make one click away.
 * - **"Assign to me"**, while the viewer does not already hold the record's first responsible
 *   kind: the commonest thing anybody does in a picker is take the work themselves.
 * - **A group per kind** this entity is offered and anybody may give — not the reflexive ones, which
 *   are a person's own answer and have their own control. Every group starts open and every group
 *   can be closed: the list of members is longer for it, and search narrows every group at once.
 * - **Every member with their face**, ringed in the tone their part wears on the card, so the picker
 *   and the card agree about who is reviewing.
 *
 * Each entry carries `kind`, and `checked` for a toggle — so one handler serves every row:
 * `spaceStore.setInvolvement(record, arg.id, arg.kind, !arg.checked)`. "Assign to me" is an action
 * with no `checked`, which that same handler reads as "on".
 *
 * Holders who have left the space are still listed, from their cached profile where there is one,
 * so a card never ticks somebody the menu cannot untick.
 *
 * ## One row per person
 *
 * `members` and `profiles` are one entry per person (`did` the person, `devices` the keys seen for
 * them), while an involvement names whichever key wrote it. A holder is found by any of those DIDs,
 * so somebody who took the work on their laptop is ticked on their one row, and the row's `id` is
 * the DID the involvement holds — what unticking has to remove. A row nobody holds offers the
 * member's first device key, the same kind of DID a record's author is; "Assign to me" offers this
 * device. `me` is `me.dids`, so the viewer is the viewer from any of their computers.
 */
import { byAnyDid, selfDids } from '../personProfile';
import {
  involvement,
  type InvolvementKindInput,
  type InvolvementRowInput,
  type PendingInvolvement,
  TONE_BY_SEMANTIC,
} from './involvement';

interface Member {
  did: string;
  /** The device keys this person was seen under — see `AgentProfileSummary.devices`. */
  devices?: string[];
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
  /** The viewer: `me.dids` (this device first), or one DID. */
  me?: string | readonly string[] | null;
  /** A name somebody said for who should do it — `TaskBlock.assignee`. See above. */
  said?: string | null;
  pending?: readonly PendingInvolvement[] | null;
}

const asRows = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export function involvementMenu(options: InvolvementMenuOptions | null | undefined): unknown[] {
  const node = options?.node ?? '';
  const entity = options?.entity ?? '';
  const self = selfDids(options?.me);
  // This device: what "Assign to me" writes, as every other write from here is signed by it.
  const me = [...self][0] ?? '';
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

  const memberRows = asRows<Member>(options?.members).filter((member) => member?.did);
  const memberByDid = byAnyDid<Member>(memberRows);
  const profileByDid = byAnyDid<Member>(options?.profiles);
  const members = new Map<string, Member>(memberRows.map((member) => [member.did, member]));
  // Somebody holding a part who has since left is still somebody the menu has to be able to untick.
  for (const person of on?.people ?? []) {
    if (memberByDid.has(person.did)) continue;
    const known = profileByDid.get(person.did) ?? { did: person.did };
    if (!members.has(known.did)) members.set(known.did, known);
    memberByDid.set(person.did, members.get(known.did)!);
  }
  const rowOf = (did: string) => memberByDid.get(did);
  const didsOf = (member: Member) => [member.did, ...(member.devices ?? [])];
  const isMe = (member: Member) => didsOf(member).some((did) => self.has(did));
  const writeAs = (member: Member) => member.devices?.[0] ?? member.did;

  const nameOf = (member: Member) => member.name || `${member.did.slice(0, 16)}…`;
  const byName = [...members.values()].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));

  const groups = kinds.map((kind) => {
    // Each holding row's member, with the DID it is held under — one row per person.
    const heldAs = new Map<Member, string>();
    for (const did of holdersOf(kind.slug)) {
      const member = rowOf(did);
      if (member && !heldAs.has(member)) heldAs.set(member, did);
    }
    const ordered = [
      ...heldAs.keys(),
      ...byName.filter((m) => !heldAs.has(m) && isMe(m)),
      ...byName.filter((m) => !heldAs.has(m) && !isMe(m)),
    ];
    const tone = TONE_BY_SEMANTIC[kind.semantic ?? ''] ?? '';
    return {
      type: 'group',
      id: kind.slug,
      label: kind.name || kind.slug,
      collapsible: true,
      collapsed: false,
      items: ordered.map((member) => ({
        type: 'toggle',
        id: heldAs.get(member) ?? (isMe(member) ? me : writeAs(member)),
        kind: kind.slug,
        label: isMe(member) ? `${nameOf(member)} (you)` : nameOf(member),
        checked: heldAs.has(member),
        avatar: { image: member.avatar ?? '', hash: member.did, tone },
      })),
    };
  });

  const doing = kinds.find((kind) => kind.semantic === 'responsible');
  const amMember = memberRows.some(isMe);
  const takeIt =
    doing && me && amMember && !holdersOf(doing.slug).some((did) => self.has(did))
      ? [{ id: me, kind: doing.slug, label: 'Assign to me', icon: 'user-circle-plus' }]
      : [];

  const said = (options?.said ?? '').trim().toLowerCase();
  const named = said
    ? byName.filter((m) => {
        const name = (m.name ?? '').toLowerCase();
        return name === said || name.startsWith(`${said} `);
      })
    : [];
  const suggestion =
    doing && named.length === 1 && !isMe(named[0]) && holdersOf(doing.slug).length === 0
      ? [
          {
            id: writeAs(named[0]),
            kind: doing.slug,
            label: `Assign ${nameOf(named[0])} — named in the conversation`,
            avatar: { image: named[0].avatar ?? '', hash: named[0].did, tone: '' },
          },
        ]
      : [];

  return [...suggestion, ...takeIt, ...groups];
}
