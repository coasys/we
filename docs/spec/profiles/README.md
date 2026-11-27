# Capability profiles

**Spec version 1.0.** Each profile carries its own semantic version ([Versioning](#versioning)).

A template reads and changes records through neutral surfaces every host provides: `$query`,
`record.*` and declared operations ([Template format](../template/README.md),
[Operations](../operations/README.md)). Some of what a template needs is not records: where the person
is, what they are looking at and how it is arranged, who else is here, who people are, the space the
template is drawn in, and which template and theme are on screen. A **capability profile** is a named, versioned contract for that host state: a
list of members, each a piece of state a template reads or an action it calls, and the change events
that say when the state moves.

A host provides profiles. How it holds the state behind them, and how it notices a change, is the
host's own: a signal graph, a struct updated each frame, a server round trip. This spec says what a
template can rely on, never how a host is built.

> **Why profiles.** Without them a template can name anything its first host happens to hold, and
> every member becomes part of the contract by accident. Seven coarse profiles are few enough for
> another host to implement on purpose and to test against, and coarse enough that a template's
> needs are a short list.

## Contents

| File                             | What it holds                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| [This file](#the-profiles)       | What a profile is, its members and events, grants, providing one, WE-host-only, versioning, conformance. |
| [Members](members.md)            | Every member of every profile: shape, arguments, group, events. Generated from the definitions.          |
| [`profiles.json`](profiles.json) | The same, as data, for tooling and for a host checking itself. Generated.                                |

## The profiles

| Profile                                       | What it covers                                                                                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`navigation`](members.md#navigation)         | The address and moving around it: the path, its query, the person's spaces, the sections of the one on screen.                                                             |
| [`view-state`](members.md#view-state)         | What is on screen and never stored in a space: the panels a template declared and their instances, scrolling to something, named clocks. Every host that draws has these.  |
| [`layout`](members.md#layout)                 | How declared panels are arranged where a host docks them in lanes: folded lanes, whether anything moved, putting it all back.                                              |
| [`presence`](members.md#presence)             | Who else is in the space right now, and what this person says about themselves to them.                                                                                    |
| [`identity`](members.md#identity)             | Who people are, as their profiles say: the person viewing, the people of the space, anybody named by a DID, and whom the person viewing has muted and what they have read. |
| [`space-settings`](members.md#space-settings) | The space a template is drawn in, what this person sees of it and their own settings for it. The space's own record changes through its operations.                        |
| [`appearance`](members.md#appearance)         | Which template and theme this person sees and may choose between: those on offer, those on screen, switching, and their own choice for the space on screen.                |

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

Actions in `space-settings` and `appearance` are pinned to the space on screen: none takes an argument
naming another space, and a host MUST NOT let one reach another.

## Providing a profile

A host that **provides** a profile at a version MUST provide every member that version lists, with
the shapes, arguments and events it gives. A host MAY provide several profiles, all seven, or none. A
host that does not provide a profile answers its members as it answers any name outside the bag: no
value, and an action that does nothing ([Degradation](../template/degradation-and-versioning.md#degradation)).

A host SHOULD say which profiles, at which versions, it provides.

A host that provides `layout` provides `view-state` too: the panels a layout arranges are the ones
`view-state` declares and opens. The other way round does not hold. A host that shows one panel at a
time, a phone, or a host that renders a page once and sends it MAY provide `view-state` alone: closing
a declared panel and opening an instance still mean what they say, and nothing in `view-state` reads
how panels are arranged.

A host shows it provides a profile by passing that profile's vectors ([Conformance](#conformance)).

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

## Conformance

The profiles' suite is a set of **vectors**: language-neutral JSON cases, each a world a host starts
with, an address, and one action of a profile with its arguments, and what a conforming host's state
reads before and after the action, with the change events it caused. A case with no action records
what the host reads out of its world. A host runs every vector of the profiles it provides and
compares; it conforms to a profile when every vector of that profile matches. A host providing
`layout` runs `view-state`'s vectors too, as it provides that profile as well.

The vectors name only profile members and plain values. They do not say how a host holds its state,
and running them needs nothing of the reference implementation but the file.

### The file

One JSON file:

```json
{ "version": 1, "profiles": { … }, "worlds": { … }, "entities": { … }, "cases": [ … ] }
```

`version` is the vector file's own format version. `profiles` names each profile at the version the
cases were recorded against. `entities` lists the record types the worlds hold records of, each as
`{ "properties": { name: { "type", "default"? } } }`: what a record reads back with is its fields, or
the default where it has none.

`worlds` holds what a case's host starts with, by name. A world is:

| Key        | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `me`       | The viewing person's DID.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `profiles` | Profiles people have published, the viewing person's included: `{ "did", "firstName"?, "lastName"?, "handle"?, "bio"? }`. Anybody else named is somebody who published nothing.                                                                                                                                                                                                                                                                                                                                                                 |
| `spaces`   | The spaces the viewing person holds: `{ "id", "name", "shared"?, "members"?, "records"? }`. `id` is what the space's address names (`/space/<id>`) and what records name the space by. A `shared` space has `members` besides the viewing person, and presence; a personal one has neither. `records` are the records it holds, in the operations vectors' shape (`{ "entity", "id", "fields", "relations"? }`); its `Space` record is the one describing the space itself, and a `Template` record's `schema` is the template's JSON, as text. |
| `own`      | Records the viewing person holds for themselves, in the same shape: they follow the person into every space and nobody else sees them (whom they muted, what they read, what they hid in a space).                                                                                                                                                                                                                                                                                                                                              |
| `peers`    | Other people present: `{ "did", "availability", "focus": { "space", "path" }, "activities"? }`, each in the space and on the page `focus` names, saying what `availability` and `activities` say.                                                                                                                                                                                                                                                                                                                                               |
| `modules`  | Capabilities the host offers that declare settings, by their declaration alone: `{ "id", "name", "settings" }`, `settings` as a module declares them (`key`, `label`, `type`, `options`, `default`, `levels`).                                                                                                                                                                                                                                                                                                                                  |
| `panels`   | The panels the template on screen declares, as its `meta.panels` does ([Panels](../template/README.md)). Each one's `home` is its lane.                                                                                                                                                                                                                                                                                                                                                                                                         |

Each case:

| Key               | Value                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`              | The case's name, unique in the file: the profile it is about, a dot, then what it shows.                                                                                             |
| `profile`         | The profile the case is about.                                                                                                                                                       |
| `note`            | One sentence saying what the case shows.                                                                                                                                             |
| `world`           | The name of the world in `worlds` the host starts with.                                                                                                                              |
| `address`         | The address the host is at when the case begins.                                                                                                                                     |
| `history`         | Optional. Addresses visited before it, oldest first, so going back has somewhere to go.                                                                                              |
| `setup`           | Optional. Actions taken before anything is read, each `{ "action", "args" }`, to reach the state the case starts from.                                                               |
| `observe`         | The state members the case reads.                                                                                                                                                    |
| `action`, `args`  | Optional. The action called, by its member name, and its arguments in order.                                                                                                         |
| `state`           | For a case with no action: what each member in `observe` reads.                                                                                                                      |
| `before`, `after` | For a case with an action: what each member in `observe` reads before the call, and once the host has finished answering it.                                                         |
| `events`          | For a case with an action: per profile, the events the call caused, in the order the profile lists them. A profile with none is left out, so `{}` is an action that changed nothing. |

Two kinds of argument are not plain JSON. `{ "$file": { "name", "type", "base64" } }` is a file the
person chose, its bytes base64-encoded. `{ "$read": [member, key, …] }` is a value read from the
host's own state at the moment of the call, following the keys into it: an argument only the host can
know, such as the id it gave a panel instance it opened (`["shellStore.panelInstances", 0, "id"]`).

### Running a vector

For each case, on a host that starts with nothing but the case's world:

1. **Build the world.** The viewing person is `me`, signed in. Publish each profile, make each space
   with its records and members, hold `own` as the viewing person's own records, make each peer
   present where its `focus` says, offer each module's settings, and have the template on screen
   declare `panels`.
2. **Open.** Visit each address in `history`, then `address`. Wait until the host has finished
   answering: the peers the world puts in the space on screen are present, and nothing any profile
   reads is changing.
3. **Set up.** Call each action in `setup`, in order, waiting after each as in step 2.
4. **Read.** Read each member in `observe`. With no `action`, this is `state`, and the case is done.
   Otherwise it is `before`.
5. **Act.** Call `action` with `args`, and wait until the host has finished answering it. While it
   does, note each state member of every profile whose value a reader sees change.
6. **Read again**, as `after`. The case's `events` are, for each profile, every event naming a member
   noted in step 5. One change can be two events: a member named by two events of a profile puts both
   in the list.
7. **Compare** `state`, or `before`, `after` and `events`, with the case, as JSON values: equal keys,
   equal values, lists in the same order — `events` for the profiles this host provides. A case
   records what its action did to every profile WE provides, so a host without `layout` leaves
   `layout`'s entry out of the comparison, and one without `navigation` leaves that out.

**Time does not pass in a case.** A clock that starts playing is read before it has moved, so a
case's clock reads are exact.

**A value as compared.** Every value read is compared as the profile's shape describes it, and no
more:

- An object's keys compare as a set. A key with no value is left out, and so are the backend's own
  write stamps (`createdAt`, `updatedAt`), which each backend makes its own.
- A record or row compares by the fields its member's shape names: `presenceStore.*` rows by `did`,
  `name`, `avatar`, `tone`, `activities`, `availability` and `focus.path`; a clock by everything its
  shape names but `atLabel`; a `viewNav` row by `id`, `segment` and `path`; `currentSpace` by `id`,
  `name`, `description`, `avatar`, `coverImage`, `defaultTemplateId`, `defaultThemeId`,
  `enabledModules`, `enabledViews` and `moduleSettings`; a `myModuleSettings` row by `group`, `key`,
  `type`, `value`, `source`, `set`, `locked` and `lockedBy`; a panel instance by `panel`, `inputs`
  and `title`; a profile by the fields `ownProfile`'s shape names.
- `mySpaces` compares as a list of `{ id, name }` sorted by `id`, and `profiles` sorted by `did`, each
  in code-point order: neither profile promises an order.
- An image the host stored is `{ "$image": true }`. What a host keeps for a picture is its own
  encoding of it; that one is set is what the profile promises.
- **Template and theme ids are opaque.** Which templates and themes a host brings itself, what it
  calls them and the ids it gives them are its own, so a vector names only those the world made — its
  `Template` and `Theme` records, by their ids, and a template by the `id` its own JSON gives it. An
  id naming one the host brought reads as `{ "$host": true }`; a list of templates or themes leaves
  the host's own out (a theme compares by `id` and `name`); an override option list compares the
  options naming what the world made, by `label` and `value`, leaving out the host's two that follow
  the space and follow the person's own default. A switcher row's `id` is the host's key for that
  choice and compares as the id of the template it offers; its group compares by its rows, its label
  being the host's words for it.

A section's label and icon, a moment's label, and an instance's id are a host's own words and names
for them, and are not compared.

### The cases

| Profile          | What its cases show                                                                                                                                                                                                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `navigation`     | The address read apart, inside a space and out; each form of path `navigate` resolves (`~/`, `?`, `..`, absolute, a query of record ids); `setParam` writing, removing, pushing and writing what is there; Back; going to another space with and without the section on screen, or to one named; following a reference to a record, a space and a person. |
| `view-state`     | Declared panels closed and put back, opened again with inputs, brought forward and closed by instance; a scroll that is no state; a clock configured, played with and without a range, paused, toggled, sought by milliseconds, by date, to everything and by fraction, and its speed and loop set.                                                       |
| `layout`         | The arrangement as declared; a declared panel closed and put back; lanes toggled, folded, unfolded and folded again; a reset, and a reset of nothing.                                                                                                                                                                                                     |
| `presence`       | The roster of a shared space and of a personal one; availability, and invisible; activities said, replaced and withdrawn by id and by type; moving page.                                                                                                                                                                                                  |
| `identity`       | Profiles, members, mutes and read markers as the world gives them; an unnamed person's assembled name; members following the space on screen while the person's own lists stay.                                                                                                                                                                           |
| `space-settings` | The space on screen and outside one, with its defaults; a picture made ready for the record, which changes nothing; a section hidden and shown again; a module hidden; this person's own setting set and cleared.                                                                                                                                         |
| `appearance`     | What is on offer in a space and outside one, and the theme on screen in each; switching to the space's template; choosing it over the default; a theme chosen for the space, the one that shows anyway, withdrawn, chosen by option, and following the person's own default.                                                                              |

Every action of every profile is called by at least one case, and every state member is read by at
least one.

### What a vector does not carry

- **The host's own templates and themes**, nor which of them is on screen when the world chose none
  (above).
- **The sections outside a space.** No case reads `spaceStore.viewNav` with no space on screen.
- **Going back from the first entry.** Back at the start of the session's history does nothing;
  the vectors start each case inside a history that already has entries.
- **How a playing clock moves**, since time does not pass in a case.

---

Implemented by: [`profileHost.ts`](../../../packages/app-shell/tests/support/profileHost.ts) (WE's
host for a case: its stores composed by `composeStores` on the in-memory backend, with the world
written in, on the test reactivity port and test platform or, through
[`profileHostSolid.ts`](../../../packages/app-shell/tests/support/profileHostSolid.ts), on Solid and the
browser platform),
[`cases/profiles.ts`](../../../packages/schema-system/conformance/src/cases/profiles.ts) (the cases and
worlds), [`record-profiles.test.tsx`](../../../packages/schema-system/conformance/tests/record-profiles.test.tsx)
(recording, `pnpm --filter @we/template-conformance record`). The vectors:
[`vectors/profiles.json`](../../../packages/schema-system/conformance/vectors/profiles.json). Pinned by:
[`profiles.test.tsx`](../../../packages/schema-system/conformance/tests/profiles.test.tsx) (every vector
run again from the file on WE's stores, under Solid),
[`profilesNeutral.test.ts`](../../../packages/schema-system/conformance/tests/profilesNeutral.test.ts)
(the same with no framework and no DOM) and
[`profilesCoverage.test.ts`](../../../packages/schema-system/conformance/tests/profilesCoverage.test.ts)
(every action called, every state member read).

---

Implemented by: [`profiles.ts`](../../../packages/schema-system/shared/src/profiles/profiles.ts)
(the definitions), [`templateSurface.ts`](../../../packages/app-shell/src/shared/registries/templateSurface.ts)
(WE's bag, whose groups each member keeps), [`hostOnly.ts`](../../../packages/schema-system/shared/src/profiles/hostOnly.ts)
and [`equivalents.ts`](../../../packages/schema-system/shared/src/profiles/equivalents.ts) (the
WE-host-only report). Pinned by: [`profiles.test.ts`](../../../packages/schema-system/shared/tests/profiles.test.ts),
[`profileSpec.test.ts`](../../../packages/schema-system/shared/tests/profileSpec.test.ts) (the listing is
current), [`capabilityProfiles.test.ts`](../../../packages/app-shell/tests/capabilityProfiles.test.ts)
(every member is classified as the bag classifies it).
