# Plan: Set semantics for `@HasMany` (`distinct`), and link provenance

> Feature request: let a `@HasMany` declare that it is a **set of targets** rather than a bag of
> assertions — and, separately, let a consumer that wants the bag see *who asserted what*. Today the
> ORM offers neither, so every reader of a scalar relation gets duplicates it did not ask for and no
> way to understand them.

> **Status (Aug 2026): not started upstream.** `RelationOptions` in
> `@coasys/ad4m/src/model/decorators.ts` carries `through`, `target`, `getter`, `local`, `filter` and
> `where`. There is no `distinct`, and nothing exposes per-link authorship through the model layer.

---

## Problem

A link is `(source, predicate, target, author, timestamp)`. A `@HasMany` reads every link from the
source under its predicate and returns the targets. Two agents writing
`collection —we://participants→ did:key:bob` therefore produce **two links**, and
`collection.participants` returns `['did:key:bob', 'did:key:bob']`.

That is not corruption, and this plan does not propose treating it as such — see
[Why this is not a data-model bug](#why-this-is-not-a-data-model-bug). The gap is that the ORM
surfaces the multiset and gives a consumer nothing to do about it:

- **No `distinct`.** A reader who wants set semantics — which is nearly every reader of a scalar
  relation — must deduplicate by hand at each call site, and will forget at some of them.
- **No provenance.** `participants: string[]` hands back bare target strings, dropping the author and
  timestamp that are the *only* things distinguishing the two links.

Which is the worst of both: duplicates you did not want, and no access to the information that would
justify keeping them.

### How it surfaced

WE's transcribe module records who was in a call on `CollectionBlock.participants`. Every agent that
was transcribing appended **every agent it could see**, with no coordination — deliberately, because
the roster is meant to include people who were present but silent, and because add-one writes are
conflict-free where a read-modify-write drops whoever loses the race.

The result was `N` links per person per session, growing on every rejoin. A two-person call drew a row
of the same two faces several times over.

It was first patched where it showed: `AvatarStack` now deduplicates by DID before drawing. That is
worth keeping as defence for existing data, but it is cosmetic — `$count` over the relation stayed
wrong, and so would any future reader.

The real fix went in on the write side: **one writer per member.** Each agent appends only its own
DID, and does so whenever it is in a call that has a record — reading the record's id off presence, so
an agent who never records and never speaks still appears. That makes the relation a set by
construction. See `recordSelfParticipation` in `packages/module-system/transcribe/src/store.ts` and
the contract note on `WeNode.participants`.

**Nothing enforces that contract.** It is a comment and one well-behaved writer. The next module to
append somebody else's DID reintroduces the problem silently, and the only thing that catches it is a
person noticing a doubled avatar row.

---

## Why this is not a data-model bug

"Alice says Bob was here" and "Bob says Bob was here" are different statements, and an agent-centric
system is right to store both. Collapsing them at the link layer would destroy information WE may well
want later — a transcript that can say *who attests* a participant was present is strictly more useful
than one that cannot.

So the fix belongs in the **ORM's read surface**, which is where "give me the members" and "give me
the assertions" are two different questions that currently have one answer.

---

## Proposed changes

### 1. `distinct?: boolean` on `RelationOptions`

```typescript
@HasMany({ through: 'we://participants', distinct: true })
participants: string[] = [];
```

When set, deduplicate targets during relation hydration, preserving first-seen order. It sits
naturally beside `where` and `filter`, which already shape the relation read.

Two open questions for whoever picks this up:

- **Default.** `false` is backwards compatible and is what this plan assumes. But `true` is arguably
  the better default for **untyped scalar** relations specifically — a `string[]` of ids is a set in
  essentially every use — and a breaking default change could be scoped to those alone.
- **Where.** Hydration is the obvious place (`Ad4mModel.ts`, the `include` walk around
  `jsonToModelInstance`, and wherever a non-included relation is populated from links). Pushing it
  down to the SPARQL projection would be faster on large relations but has to survive `where`,
  `filter` and ordering interacting with it.

### 2. Optional, separable: expose link provenance

For consumers that want the bag *because* it is a bag:

```typescript
@HasMany({ through: 'we://participants', withLinks: true })
participants: LinkRef[] = []; // { target, author, timestamp }
```

Independent of (1) and lower priority — but worth designing alongside it, because together they turn
"duplicates you cannot explain" into two deliberate choices. WE has no consumer for this today.

---

## Scope

- Changes are in `@coasys/ad4m` core: `src/model/decorators.ts` (the option), `src/model/Ad4mModel.ts`
  and `src/model/hydration.ts` (the read path).
- Backwards compatible with `distinct` defaulting to `false`.
- Per `CLAUDE.md`, WE consumes `@coasys/ad4m` from a published npm tag, so landing this means
  publishing a tag and bumping the `pnpm` override — a cross-repo change, not a local one.

---

## What this unblocks in WE

WE is **not blocked**. The one-writer rule already produces correct data for anything recorded after
it. What the option changes is that the guarantee stops depending on every future writer knowing
about it.

| Today | With `distinct: true` |
| --- | --- |
| `WeNode.participants` carries a prose contract nothing enforces | The relation declares its own semantics; a misbehaving writer cannot corrupt the read |
| `AvatarStack` deduplicates before drawing, for every caller | Still wanted as defence for pre-existing data, but no longer load-bearing |
| A new writer appending another agent's DID breaks the roster silently | Costs a redundant link and nothing else |

### Cleanup once it lands

1. **Add `distinct: true`** to `WeNode.participants`, and to `comments` / `signals` / `calls` if the
   same reasoning applies — each should be checked rather than assumed.
2. **Reconsider the coverage rule in transcribe.** With `distinct`, cross-appending is no longer
   *wrong*, only wasteful, so "each agent appends everyone it can see" becomes available again. It is
   worth re-examining rather than reinstating: self-appending also gives better coverage, because a
   silent participant currently appears only if somebody else happens to flush while they are there.
   Keep the effect either way; the decision is only about whether to append others as well.
3. **Backfill or leave the duplicated history.** Existing call records keep their duplicate links.
   Either a one-off cleanup that removes redundant links per `(source, predicate, target)`, or accept
   that old transcripts read through the drawing-time dedupe. Leaving them is defensible; deleting
   another agent's assertion is not obviously ours to do, which is itself an argument for (2)
   preferring self-appends.
4. **Revisit the `AvatarStack` dedupe** only if a caller ever needs to show repeats. Until then it
   costs one memo and protects every caller, including ones reading relations WE does not own.

Nothing about the predicates, the module contract or the stored shape changes — which is why the WE
side is safe to do first and the upstream option is an improvement rather than a correction.

---

## Related

- `polymorphic-has-many.md` — the other `@HasMany` gap, and the same shape of argument: WE works
  around it today, the ORM should eventually own it.
