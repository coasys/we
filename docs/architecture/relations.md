# Relations — where a connection between two things should live

WE can express a connection between two records in three different places, and they are not
interchangeable. This is the decision procedure, and the reasoning behind it.

## The axis that actually decides it

**Is the connection a statement about the _type_, or a statement about the _pair_?**

`Task.assignee` is a claim about the class: every task may have one, decided before any task existed,
by whoever owns the vocabulary. "This task came out of that call" is a claim about two specific
records, made afterwards, by a person who noticed something.

Those want different homes regardless of how many of each there are. Scale, combinatorics and query
cost all matter, but they are consequences of this distinction rather than the thing itself — and
the same distinction decides where a _position_ lives, which is why `Placement` exists rather than
`x`/`y` on a block.

## The three tiers

|                        | Authored by               | Cost to add                         | Query by it                     | Carries its own data | Visible as a kind |
| ---------------------- | ------------------------- | ----------------------------------- | ------------------------------- | -------------------- | ----------------- |
| **Free-text label**    | any member, in the moment | nothing                             | no                              | yes                  | no                |
| **`RelationshipType`** | the community             | one record                          | `where: { relationshipTypeId }` | yes                  | yes               |
| **Declared relation**  | whoever owns the schema   | a Shape edit, or a release for core | fully                           | **no**               | n/a               |

### Free text — where a vocabulary is discovered

A `Relationship` with a `label` and no kind. Costs nothing, needs no permission, and is right while
nobody yet knows what kinds of connection this community makes — which is the state every new space
is in.

What it cannot do is be queried or drawn. "contradicts", "Contradicts" and "contradicts?" are three
different relations to a `where` clause, so a template cannot filter on one, count them, or give a
kind its own colour.

### `RelationshipType` — the community's own vocabulary

The middle tier, and the one that carries most of the weight in practice. Deliberately the same
shape as `SignalType`: a community names its own vocabulary, as data, in its own space, and
instances reference it by id.

It buys three things a label cannot:

- **Query pushdown.** `where: { relationshipTypeId }` is a native equality that composes with
  `order` and `limit`.
- **Consistency.** One record, one spelling, one meaning — and a count you can trust when deciding
  whether to promote.
- **Visibility.** An edge style can key on the kind, so a community's vocabulary is _seen_ rather
  than read. A map whose kinds are legible at a glance is a different instrument from one where
  every line has to be read to be understood.

`directed` and `inverseName` live here for the same reason: "contradicts" is asymmetric and "related
to" is not, and drawing an arrowhead on the second asserts something nobody meant.

### A declared relation — committed vocabulary

`@HasOne` / `@HasMany` on the model class. Gets the full query surface: `include` hydration,
ordering by a related property (`order: { 'location.country': 'asc' }`), count projections, target
typing.

And it can carry **nothing about the connection itself**. A declared relation has no identity, so
there is no author, no date, nothing to comment on and nothing to rate. `task.assignee = did` cannot
express "James says Sarah owns this and Alice disagrees".

## Decision rules

1. **Can the connection be disputed, rated, commented on, dated or attributed?** → reify. Not a
   threshold but a requirement: a declared relation has nothing to hang any of that on.
2. **Will you filter, sort, `include` or count _by_ it?** → declare. This is the rule that overrides
   the elegance argument, and the one most easily lost: a reified relationship has no query
   pushdown at all, and resolving the far end is manual.
3. **Is the relation kind fixed when the schema is written, or invented by members as they go?** →
   declare / reify respectively. This is where combinatorics bites: you cannot declare
   `contradicts` × `supersedes` × `inspired-by` across every pair of twenty-five types, because
   those were never facts about types.
4. **Written by code, per record, as part of creating that record?** → declare. **Written by a
   person, deliberately, occasionally?** → reify. A declared relation is one link; a `Relationship`
   is an expression plus six or seven. Irrelevant at hand-drawn volume, ruinous at
   every-message-links-to-its-author volume.
5. **Both directions matter equally and neither end owns the other?** → reify. WE's declared
   relations are one-directional — the manifest emits no `reverseOf` and the query IR only walks
   forward — so a symmetric relation declared on one side is a lie about which side is which.

## Promotion, and its cost

**Reification is the staging area for schema.** Free text is where relations are discovered, a named
kind is where a community agrees on one, and a declared relation is where it commits.

The trigger for promoting is: **when you want to query _by_ the relation rather than filter a list
of them.** That subsumes frequency — nobody wants to query by something used twice, and a kind used
four hundred times is one somebody will.

WE is unusually well set up for this because the shape wizard means promoting a community model's
relation does not need a release. What is _not_ free is the data: a declared relation is a different
set of links, so existing `Relationship` records have to be converted and then removed. A script,
per space. Cheap enough to be worth doing when the query surface is what you need, and expensive
enough not to do speculatively.

## What the graph engine does with all this

Nothing different, which is the point. The `entity` expander walks declared relations; the `reified`
map collapses relationship entities into edges. A reader cannot tell which is which unless a
template styles them apart — and WE's default template does, deliberately: drawn connections are
heavier and coloured, because the distinction that matters on a knowledge map is "a schema says so"
against "a person says so", and the second is the one worth arguing with.

So the choice of tier is a modelling decision, not a UX one. Getting it wrong costs query power or
provenance; it does not cost a rewrite of anything that draws.

## Worked examples

| Connection                          | Tier                              | Why                                                                                 |
| ----------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------- |
| `CollectionBlock.children`          | declared (untyped)                | Structural, written by the composer per block, queried constantly.                  |
| `Space.location`                    | declared                          | A fact about the class, one per space, nothing to dispute.                          |
| `WeNode.comments`                   | declared (untyped)                | Written by code on every reply; the _comment_ carries the provenance, not the link. |
| "This contradicts that"             | reified + kind                    | A claim, arguable, authored, and the vocabulary is the community's.                 |
| "This card sits here on this board" | reified (`Placement`)             | A fact about the pair — the same note sits elsewhere on another board.              |
| A reaction                          | reified (`Signal` + `SignalType`) | Per agent, per node, with a vocabulary the community names. Already this shape.     |

The last row is worth noticing: signals arrived at the same three-tier answer independently, before
any of this was written down. That is the strongest evidence the shape is right.
