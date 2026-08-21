# @we/template-kit — Fragment Authoring Conventions

Rules for adding to or changing this package. The package's purpose and the fragment architecture
live in [README.md](./README.md) and `docs/architecture/template-fragments.md`; this file is the
working ruleset.

These rules also govern **module-provided fragments** — a feature module shipping ready-made
schemas beside its components (`@we/module-graph`'s `fragments.ts` is the first). Same options-object
API, same body style, same doc-comment duty; only the address differs.

## Should this be a fragment at all?

> **Code owns only what data cannot express.** Behaviour and focus management, accessibility
> semantics, browser APIs, measurement, performance-critical rendering — that is the whole list.
> Everything above it is arrangement, and arrangement stays data.

| It wants to be                    | When                                          | Example                  |
| --------------------------------- | --------------------------------------------- | ------------------------ |
| A primitive (`@we/primitives`)    | focus trap, top layer, keyboard, ARIA         | `we-modal`               |
| A component (`@we/components`)    | measurement, layout maths, third-party libs   | `AvatarStack`            |
| **A fragment (here)**             | arrangement, however often repeated           | `gatePrompt`, `cardList` |
| An operator (`@we/schema-shared`) | schema boilerplate that is component-agnostic | `$in`                    |

The pairs come apart deliberately: `AvatarStack` is a component (overlap maths) and the count beside
it is a fragment; `we-modal` is a primitive and the confirm dialog inside it is a fragment. When the
repetition is a `value`/`onInput` wiring pattern, check whether it is component-agnostic before
reaching for an operator — `field` stayed a fragment because _which event carries the value_ is
design-system knowledge, and an operator would smuggle that table into the schema resolver.

## When to extract

- **Three real uses of the same shape.** Two is a coincidence.
- **Or the divergence is a bug** — nine lists missing the empty state five others had; four avatar
  stacks seeded with a literal where one had it right.
- **Never speculatively.** A fragment merges in the same commit as the call sites it replaces. An
  export with zero callers is marketplace-vocabulary noise and untested API.
- **Not when the third call site costs three options.** An over-parameterised fragment is worse
  than the duplication, because it also hides it. Leave the odd one hand-written and say why at the
  call site.

## API shape

- **Always a single options object**, never positional arguments — every fragment reads the same
  way at a call site, and options can be added without a migration.
- Types say what a value is for:
  - `string` — plain text the fragment may interpolate (labels it adds a colon to, nouns it
    pluralises). Never accept `Content` where the body does `` `${value}` `` — a token object would
    render `[object Object]`.
  - `Content` (from `types.ts`) — anything legal in a `children` position.
  - `SchemaProp` — an expression: a context ref, a token, a literal.
  - `LocalStateField` — pass-through `$localState` declarations. Import it; don't hand-roll the
    shape.
- An option that only reproduces a difference between two existing call sites is drift being
  promoted to API. Decide which call site is right instead.

## Body style — the fragment reads as the tree it emits

A fragment's body has one special property: it can _look like_ the JSON it produces, which makes it
self-documenting and keeps it visually parallel to its recipe in `@we/ai-context`. Protect that.

- **Name a node only when the output references it more than once** — usually because an option
  rearranges structure and the arrangements share pieces (`agentByline`'s `avatar` in both
  layouts; `confirmModal`'s `close` in three positions). Everything else is written inline, in
  place, however deep.
- **Bulk and comments are never a reason to extract.** A single-use subtree stays inline; the
  comment stays with it.
- **Derived scalars are fine** (`` const key = `${opts.as}Rows` ``), and so is a derived _value_ with
  branching where inlining would nest ternaries inside the tree.
- **The other direction cuts too:** two near-identical branch literals differing in the middle are
  how the marketplace browsers drifted apart. If avoiding that needs many named parts, it is
  usually two fragments.
- Spreads by intent, not habit:
  - value has a default, key always present → `px: opts.px ?? '400'`
  - the key itself is optional → `...(opts.minHeight !== undefined && { minHeight: opts.minHeight })`

## Colour — roles only

Every `bg`, `color` and border colour a fragment emits names a **semantic role** (`surface`,
`textMuted`, `border`, `accentStrong`, `dangerText`), never a scale position. A fragment is the
shape many templates inherit, so a `neutral-100` here is a theme-independence bug reproduced at
every call site at once — which is the same reason fragments exist.

`page` / `surface` / `surfaceRaised` / `surfaceSunken` say where the box sits, so pick by what the
fragment actually renders rather than by which grey looked right: a floating panel is `surfaceRaised`
whatever its shadow, and an inset well inside a card is `surfaceSunken`. Text on an accent fill is
`accentText`; an accent-coloured heading on an ordinary surface is `accentStrong`. The full table is
in `@we/ai-context`'s Design System Props fragment, and the reasoning is in
`packages/design-system/1-tokens/CONVENTIONS.md`.

A fragment taking a colour as an **option** should let the caller pass a role and default to one
(`opts.tone ?? 'textMuted'`). The one exception is a palette — a graph fragment colouring nodes by
category is choosing from a scale on purpose, and a theme should not recolour a category into a
status.

## Ambient scope

Fragments may read `$local` from ancestors and write results into `$local` — that is what makes
`cardShell` usable without threading `displayMode` through every layer. The costs are borne by
documentation until insert-time checking exists:

- **Every read up the tree and every write into it is declared in the fragment's doc comment**, the
  way `lists/cards.ts` opens with its `displayMode` / `<as>Rows` contract.
- **Only `we/` may name a store.** The tier split is the package's real dependency declaration —
  see README.

## Documentation

- Every fragment carries a doc comment saying **why it exists** — the bug or drift it ended — not
  just what it renders. The kit is also the record of what the shapes learned the hard way (the
  bare-`$item` hash, the collapsing `AvatarStack` row).
- **When an expansion changes materially, update its recipe** in
  `@we/ai-context/src/fragments/patterns.ts`. The recipe and the fragment are two renderings of one
  decision; a drifted recipe teaches the AI a shape the codebase stopped using.
