# Capability profiles

**Spec version 1.0.** Each profile carries its own semantic version ([Versioning](#versioning)).

A template reads and changes records through neutral surfaces every host provides: `$query`,
`record.*` and declared operations ([Template format](../template/README.md),
[Operations](../operations/README.md)). Some of what a template needs is not records: where the person
is, what they are looking at, who else is here, who people are, and the settings of the space the
template is drawn in. A **capability profile** is a named, versioned contract for that host state: a
list of members, each a piece of state a template reads or an action it calls, and the change events
that say when the state moves.

A host provides profiles. How it holds the state behind them, and how it notices a change, is the
host's own: a signal graph, a struct updated each frame, a server round trip. This spec says what a
template can rely on, never how a host is built.

> **Why profiles.** Without them a template can name anything its first host happens to hold, and
> every member becomes part of the contract by accident. Five coarse profiles are few enough for
> another host to implement on purpose and to test against, and coarse enough that a template's
> needs are a short list.

## Contents

| File                             | What it holds                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| [This file](#the-profiles)       | What a profile is, its members and events, grants, providing one, WE-host-only, versioning.     |
| [Members](members.md)            | Every member of every profile: shape, arguments, group, events. Generated from the definitions. |
| [`profiles.json`](profiles.json) | The same, as data, for tooling and for a host checking itself. Generated.                       |

## The profiles

| Profile                                       | What it covers                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [`navigation`](members.md#navigation)         | The address and moving around it: the path, its query, the person's spaces, the sections of the one on screen.           |
| [`view-state`](members.md#view-state)         | What is on screen and never stored in a space: the panels a template declared, the theme shown, named clocks.            |
| [`presence`](members.md#presence)             | Who else is in the space right now, and what this person says about themselves to them.                                  |
| [`identity`](members.md#identity)             | Who people are, as their profiles say: the person viewing, the people of the space, anybody named by a DID.              |
| [`space-settings`](members.md#space-settings) | The space a template is drawn in and what a template may change about it: its look, its defaults, what this person sees. |

The listing in [Members](members.md) and [`profiles.json`](profiles.json) is normative; the
descriptions in it are part of each member's meaning.

## Members

A member has a **name**, a **kind**, a **capability group**, and either a **shape** or **arguments**.

- **The name** is what a template writes: `<namespace>.<member>`, read as `{ "$": "routeStore.params.id" }`
  or called as `{ "$invoke": "routeStore.navigate" }`. The namespace is a fixed part of the name and
  says nothing about how the host holds the value; another host provides `routeStore.params` by that
  name whatever it keeps behind it.
- **State** is read in expressions. Its **shape** is written as a type expression (`string`,
  `string[]`, `Record<string, string>`, `{ id: string, … }[]`); a capitalised name such as `Space` is
  the record of that entity, with the fields its model declares. A host MUST answer a read with a
  value of that shape, or with no value where the description says it may be absent. Reading a member
  never changes anything.
- **An action** is called through `$invoke` with its **arguments**, in order. A host MUST accept every
  argument listed and MUST ignore arguments beyond them: a template-tier call passes no more, and a
  host that read extra arguments could be steered by a template past what the profile promises. What
  an action answers is not part of the profile unless its description says so.
- **Ambient** actions change only what this person is looking at and MAY run with nobody asking; every
  other action runs only during a gesture ([Gestures](../template/safety.md#gestures)).

## Change events

Each profile lists its **events**: the changes a template can observe, each naming the state members
whose values it moves. A member's listing names the events that change it (for state) or that it may
cause (for an action).

- When an event happens, a host MUST make every member it names read its new value before anything
  drawn from them is drawn again. A template never sees half an event: after a navigation,
  `routeStore.currentPath` and `routeStore.params` describe the same address.
- A state member changes only through an event that names it. An action changes only state its
  events name, and the events of other profiles its description names (showing a section changes
  the sections `navigation` lists).
- How a host delivers an event (a notification, a re-read, a frame) is its own; only what reads
  return before and after is specified.

## Grants

Every member carries the [capability group](../template/safety.md#capability-grants) that grants it.
A profile says what a host provides; the group still decides whether a template may have it, exactly
as for anything else in the bag. A template granted some of a profile's groups sees those members
and not the others, which are absent rather than blocked.

Actions in `space-settings` are pinned to the space on screen: none takes an argument naming another
space, and a host MUST NOT let one reach another.

## Providing a profile

A host that **provides** a profile at a version MUST provide every member that version lists, with
the shapes, arguments and events it gives. A host MAY provide several profiles, all five, or none. A
host that does not provide a profile answers its members as it answers any name outside the bag: no
value, and an action that does nothing ([Degradation](../template/degradation-and-versioning.md#degradation)).

A host SHOULD say which profiles, at which versions, it provides.

> **Planned.** Profile conformance vectors: each action recorded as state before, the call and its
> arguments, the state after and the events it caused, in the same language-neutral JSON as the
> operations vectors, so a host tests its navigation, view state or presence against them rather
> than against this prose.

> **Planned.** A template names the profiles it needs, with the version it was written against, in
> `meta.requires` ([Declaring what a template requires](../template/catalogs.md#declaring-what-a-template-requires)),
> so a host can say what it lacks before drawing.

## WE-host-only

A member a host offers templates outside every profile is **host-only**: it works on that host and
nowhere else. WE's own host has many: its account and runtime settings, its library and editor, and
view models and writes that predate the neutral surfaces.

A validator SHOULD report every host-only member a template uses, without refusing the template, and
SHOULD name the neutral equivalent where one exists (a `$query`, a field of a record a profile
provides, `record.*` or a declared operation). Nothing a template writes may make a host-only member
part of a profile; only a new profile version can.

## Versioning

Each profile carries a semantic version, `major.minor.patch`.

- **Minor** adds: a member, an event, an optional trailing argument, a member to an event's list
  where the member already changed then.
- **Major** is anything else: a member removed or renamed, a shape or an argument changed, a required
  argument added, an action that newly needs a gesture, a member moved to a different group.
- **Patch** changes descriptions without changing meaning.

A host providing a profile at `1.2` provides everything `1.0` and `1.1` did. A template written
against `1.0` runs on any `1.x` host.

---

Implemented by: [`profiles.ts`](../../../packages/schema-system/shared/src/profiles/profiles.ts)
(the definitions), [`templateSurface.ts`](../../../packages/app-shell/src/shared/registries/templateSurface.ts)
(WE's bag, whose groups each member keeps), [`hostOnly.ts`](../../../packages/schema-system/shared/src/profiles/hostOnly.ts)
and [`equivalents.ts`](../../../packages/schema-system/shared/src/profiles/equivalents.ts) (the
WE-host-only report). Pinned by: [`profiles.test.ts`](../../../packages/schema-system/shared/tests/profiles.test.ts),
[`profileSpec.test.ts`](../../../packages/schema-system/shared/tests/profileSpec.test.ts) (the listing is
current), [`capabilityProfiles.test.ts`](../../../packages/app-shell/tests/capabilityProfiles.test.ts)
(every member is classified as the bag classifies it).
