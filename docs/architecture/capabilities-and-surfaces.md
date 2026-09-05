# Capabilities and surfaces

Where a new thing goes: is it a module or part of the host, does it ship a panel or a fragment, who
decides where it sits, and how two capabilities work together without knowing about each other.

Written down because the answers turn out to be deducible from four rules, and because half of what
follows is _why not_ — the shapes that look right, have been proposed more than once, and are
refused on purpose. Those are the parts that get re-litigated when nobody wrote down the reason.

`chrome-and-panels.md` names the things on screen and the rules about which moves for which; this
is the layer above it, about who owns what.

## Four questions, one owner each

Every feature answers four questions, and they have different owners. Most arguments about where
something belongs are two of these being answered as one.

|                 | Question                         | Owner                                                               |
| --------------- | -------------------------------- | ------------------------------------------------------------------- |
| **Capability**  | What can it do?                  | a port, a host store, or a module                                   |
| **Composition** | What is it made of?              | the capability ships defaults; the interface arranges them          |
| **Placement**   | Where does it sit, and is it up? | the host, from the interface's declaration and the reader's choices |
| **Connection**  | What is it wired to?             | the space, as data                                                  |

## Capability: port, host store, or module

Work down the list and stop at the first that fits.

1. **Does the backend do it?** → a **port**. `TranscriptionPort`, `InterpretationPort`,
   `EphemeralPort`. Declared in `@we/backend-shared`, implemented per backend, wired by the host.
2. **Do other capabilities or the host's own surfaces _call_ it?** → a **host store**. They cannot
   call a module, so anything with more than one caller has to be reachable without an install.
3. **Can a deployment omit it, with nothing else calling it?** → a **module**. Its own store, its
   own entities, its own chrome, its own launcher, enabled per space.

**Complexity never decides.** Modules ship stores — `createStore(deps)` is part of the contract, and
`@we/module-transcribe`'s is the largest store in the repo. "It has a lot of state" is not an
argument for the host.

**Neither does how core it feels.** Calls are as central to WE as anything and are a module, because
a deployment can ship without them and nothing else calls them.

### Called versus observed

A capability that only **observes records and produces records** is never called by anyone — it is
_wired_ — so it stays a module however many things use it. Translation, summarisation, tagging and
redaction are all leaves, and the host does not accrete them.

This is the distinction that keeps rule 2 from swallowing the world. Interpretation is host state
because the host itself calls it: the shell reports whether the node is capable, space settings show
its targets, and `DatasetStore` gathers the turns. Move that configuration into the space and those
calls go away — at which point interpretation could legitimately be a processor module. Its home
follows from where the configuration lands, not from taste.

## Capabilities meet in a medium, never in each other

A module may not depend on a module. Stated as a prohibition it explains nothing, and the missing
half is where the join is supposed to go. Positively:

> **Capabilities meet in a medium the host provides — the graph, presence, ephemeral, anchors — and
> never in each other.**

This is already how the two most obviously cooperating modules work. `@we/module-transcribe` finds
the live call through **presence** — `activitiesOfType(peers, 'call')`, reading the record id off
the activity — and never names `modules.call.*`. Modules extend each other's chrome through
**anchors**: one declares `anchors: ['call-controls']`, others contribute, `$slot` renders them.
Neither is a dependency, and turning either module off degrades to "nothing matched" rather than to
something broken.

Two capabilities that meet in the **graph** need nothing at all: one writes records, the other reads
them, and neither knows the other exists. That is the strongest form, and the one to reach for.

### Why not allow declared module-to-module composition

Modules here are per-space switches, not build-time packages. A dependency turns one toggle into a
graph a person has to reason about — switching calls off silently disabling three other things, in a
settings screen that said nothing about them — and it would need resolution in the seed, in
per-space enablement, and in the marketplace. Medium composition needs none of that.

A module **family** may share packages at build time (the globe is module, protocol, layers and
widget). That is packaging; the modules still do not reach for each other at runtime.

## A join between two capabilities is a policy, and policies live with the state they read

"While a call's transcript is growing, keep extracting from it" is not transcription and not
interpretation. It is a **policy**, and putting it inside either capability is what creates a
dependency between them — which is exactly how `@we/module-transcribe` came to hold the watch
lifecycle and re-publish nine of interpretation's members.

Policies belong with the state they read: the space. `Space.autoInterpret` and
`Space.extractionTargets` are already two thirds of this one, and the auto-processor it registers is
already a scope query stored in the shared graph. Written as data rather than as an effect inside a
capability, a policy becomes a **wire**: a trigger, a selector over records, a processor, and its
options.

A wire names **records, never modules**. If it named modules it would be module-to-module coupling
moved into data; naming records means any producer writing the same shape feeds the same processor,
which is what makes both sides reusable. The selector needs no new language — `{ entity, where }` is
the where-object `$query`, `filter` and `find` already take.

## Configuration: availability intersects, settings resolve

A capability answers to two different kinds of decision and they must not be confused, because the
rule that makes one correct makes the other useless.

**Whether it runs here is availability**, and it is four answers to one boolean — registered ∩
installed ∩ enabled, less muted. Every layer can only _subtract_, because "available" is the kind of
thing anyone in the chain may withhold: the deployment says what exists, the agent says what they
want anywhere, the community says what it runs, the agent says what they want here.

**What it does when it runs is a setting**, and a setting is a value. Those resolve by
**specificity** — deployment, then the agent everywhere, then the community here, then the agent
here — because a community choosing a value is choosing it rather than setting a floor. AND-ing
values would make it impossible to express anything but a boolean, and impossible to express that
except as a veto.

The veto is real for some settings, so it is declared per setting rather than assumed: `restrict` is
the AND, for the ones a lower level may refuse and never grant. Recording is the case — a community
that has switched it off is not overridable by a member, and a member who has switched it off is not
overridable by the community. A decision about a microphone travels in one direction only.

Two rules that hold at every level. **Absent is not off**: a level that has never been touched has no
opinion, so a setting added later does not silently take effect as `false` in every space that
predates it. And **clearing writes silence**, never a value that happens to equal the default — a
stored default goes on overruling everything less specific while its control reads as untouched.

A capability declares its settings and reads back resolved values; it never sees a level, and it
never reads a `Space`. That is what keeps the policy beside the state that holds it rather than in
the module, and it is why the declaration also renders the control: a module that adds a setting
gets a screen with nothing to register, which is the step whose omission is otherwise silent.

**What is not a setting**: a processor's own configuration. `Space.autoInterpret` and
`Space.extractionTargets` look like settings and are the parameters of a _wire_ — whether one exists,
and what its processor writes. They stay where they are until wires do, because moving them onto the
settings layer would be migrating them twice.

## Composition: a capability's presentation is a default, not a monopoly

Modules ship presentation, as data. `@we/module-notes` and `@we/module-call` contain no framework
code at all; every piece of their UI is a schema fragment. That is right and does not change.

What is wrong is presentation being _only_ available whole. A module's panel is usually several
surfaces in one — the transcribe panel is a feed, a record control, an extraction readout, a
proposals review and a target list — and an interface that wants them arranged differently can today
only hand-write copies. So:

- A module publishes **named parts** (`ModuleDefinition.schemas`, keyed `<moduleId>.<name>`), and
  composes its own panel out of them. Templates that place the whole panel are unaffected.
- A host capability's parts are host-authored fragments in `@we/template-kit`. Templates cannot
  import modules — that edge is sideways — so a part is named as a string and resolved by the host.
- Parts take **arguments**. A feed hardcoded to its module's own collection cannot be reused over
  another one, so a part's signature is part of its public API.

**Named parts are public API.** A module cannot reshape them without breaking templates it has never
heard of, so keep the set small and named for what a part _is_ rather than how it looks.

## Placement: three rungs, for every property

Every reader-visible property of a surface resolves the same way, in the same order:

| Property       | Suggestion                     | Declaration                 | Disposition                      |
| -------------- | ------------------------------ | --------------------------- | -------------------------------- |
| Position, size | the module's opening bid       | `meta.panels`               | what the reader dragged          |
| Openness       | the module's request           | `meta.panels`               | what the reader opened or closed |
| Content        | the capability's default parts | the interface's composition | —                                |

The disposition is stored per interface, so switching template is non-destructive and an author
improving a layout is not overruled forever by one stray drag.

Read `open` as a **request** — "this surface is wanted, somebody pressed record" — rather than as
placement. It then belongs to no panel in particular: the interface has declared what plays that
role, and the host resolves one against the other.

### Panel, view, or layout

- **Panel** if it must float, be moved, be closed, or outlive the route.
- **Layout** inside a view otherwise — a dashboard where nothing overlaps is a `Grid` of cards.
- **View** when a _page_ needs its own arrangement. `meta.panels`' `route` says _whether_ a panel is
  present, never _where_: a panel that moved between pages would work until the reader dragged it
  once, because a placement is keyed by template and panel and outranks every declaration.

## Grants follow authorship, not render site

What a node may name is decided by **who wrote it**. Repo-authored chrome gets chrome grants
wherever it renders; a template's node gets template grants wherever it renders — including inside a
dock frame, which is itself chrome and needs `host-layout` members the template must not have.

## What is refused, and why

|                                   | Why                                                                                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A module contributing routes**  | Installing a module never changes the address space. It ships parts; an interface gives them a page, or its family ships a _view_, which is separately installable. URLs stay the interface's. |
| **Middleware**                    | A capability observes and produces; nothing sits in another's write path. Moderation acts after the fact. Interception is where a plugin system becomes an attack surface.                     |
| **Extending another entity**      | Relate, don't extend — a record pointing at a `TaskBlock`, not a column added to it. See `relations.md`.                                                                                       |
| **Per-route panel positions**     | Breaks on the first drag; see the three rungs.                                                                                                                                                 |
| **Module-to-module dependencies** | Turns a per-space toggle into a dependency graph a person must reason about.                                                                                                                   |

## Open, and deliberately unbuilt

- **Triggers.** A wire is _trigger + selector + processor_, and the graph offers exactly one
  trigger: records changed. Anything periodic — a digest, a nightly re-index — has no medium.
- **Declared shapes.** The media are typed by convention: `type: 'call'` on an activity, `kind:
'call'` on a collection, an anchor string. `anchors` is declared and a contribution to an anchor
  nobody opened is reported; records and activities have no equivalent. Wires need this, or an
  unmatched wire fails as silence — the failure this codebase keeps meeting.
- **Consent for wires.** A wire is shared, so joining a space inherits its automations, and one
  spends an LLM budget on whichever peer runs it. `autoInterpret` already has this property; a wire
  is far more expressive, so node-level consent should be explicit rather than implied by
  membership.
- **A group the host declares.** Settings are grouped by module id today, so a capability the host
  holds rather than a module — interpretation — has nowhere to declare one. The storage is keyed by
  a string and cares about nothing else, so a host group is additive with no migration; it is unbuilt
  because it would have no members until interpretation is a module, and a declaration nothing reads
  is the globe's catalogue again.
- **Space presets.** A space's setup is already a bundle of records — template, theme, enabled
  modules and views, shapes, signal types — with no name, so every space is assembled by hand. Seed
  is to deployment as preset would be to space. Worth naming once wires exist and not before.

A template must **not** carry wires. It is the thing you install from a stranger, and the worst an
installed template can do today is name capabilities you granted; carrying wires would let one start
LLM passes on your node. If a template wants to express one, it does so the way `meta.themeId`
suggests a theme — a suggestion adopted by somebody who can administer the space, never a setting.
