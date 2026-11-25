# Capability profiles: members

Every member of every profile, with its shape, its arguments, its capability group and the change
events it is part of. The normative rules for reading this listing are in [the README](README.md);
the same data, for tooling, is [`profiles.json`](profiles.json).

| Profile | Version | Members |
| --- | --- | --- |
| [Navigation](#navigation) | 1.0.0 | 12 |
| [View state](#view-state) | 1.0.0 | 21 |
| [Presence](#presence) | 1.0.0 | 7 |
| [Identity](#identity) | 1.0.0 | 4 |
| [Space settings](#space-settings) | 1.0.0 | 11 |

## navigation

**Navigation, version 1.0.0.** The address, and moving around it: where the person is, the query on the page, the spaces they hold and the sections of the one on screen, and going somewhere else.

### State

| Member | Shape | Group | Events | Holds |
| --- | --- | --- | --- | --- |
| `routeStore.currentPath` | `string` | `view-state` | `address` | The path on screen, without its query. |
| `routeStore.segments` | `string[]` | `view-state` | `address` | The path split at each "/", empty segments left out. |
| `routeStore.templateSegments` | `string[]` | `view-state` | `address` | The segments below the prefix the host mounts the template under: the template’s own coordinate space, the same wherever the host puts it. |
| `routeStore.params` | `Record<string, string>` | `view-state` | `address` | The address’s query parameters, by name, as text. A record’s id is one of these, never a segment. |
| `spaceStore.mySpaces` | `Space[]` | `navigation` | `spaces` | Every space the person holds, as Space records. Ordering and grouping them for a list is the template’s. |
| `spaceStore.spacePath` | `string` | `navigation` | `space` | The path the space on screen’s own pages hang off, empty outside a space. For a link that must reach the space from a surface whose "~/" is its own root. |
| `spaceStore.viewNav` | `{ id: string, segment: string, label: string, icon: string, path: string }[]` | `navigation` | `space` | The sections of the space on screen, as a navigation strip reads them: those the community enabled, less those this person hid, in order. The same list the host builds the section routes from. |

### Actions

| Member | Arguments | Group | Ambient | Events | Does |
| --- | --- | --- | --- | --- | --- |
| `routeStore.navigate` | `to: string`, `options?: { query?: Record<string, string> }` | `navigation` | yes | `address` | Goes to a path, resolved against the route the calling node is in: "." is that route, ".." the one above, "./x" a page below, "~/x" from the template’s root, "?q" the page on screen with that query, and an absolute path leaves the template. |
| `routeStore.setParam` | `name: string`, `value: string \| null`, `options?: { push?: boolean }` | `view-state` | yes | `address` | Writes one query parameter, or removes it with null. Replaces the history entry unless `push` asks for a new one. |
| `routeStore.back` | none | `navigation` | yes | `address` | Goes back one history entry. Does nothing at the start of the session’s history. |
| `spaceStore.navigateToSpace` | `spaceId: string`, `view?: string` | `navigation` | yes | `address`, `space` | Goes to a space the person holds, by its dataset id or its shared id, and optionally to one of its sections. |
| `spaceStore.openRecordRef` | `ref: string` | `navigation` | yes | `address`, `space` | Goes to whatever a record reference names: the space, and the record’s own page in it. A reference naming only a dataset opens the space; one naming a person does nothing. |

### Events

| Event | Changes | When |
| --- | --- | --- |
| `address` | `routeStore.currentPath`, `routeStore.segments`, `routeStore.templateSegments`, `routeStore.params` | The address changed: a navigation, a query parameter written, or a step through history. |
| `space` | `spaceStore.spacePath`, `spaceStore.viewNav` | A different space is on screen, or the sections of this one changed. |
| `spaces` | `spaceStore.mySpaces` | The person joined, left or made a space, or one they hold changed. |

## view-state

**View state, version 1.0.0.** What the person is looking at that is not the address and is never stored in a space: the panels a template declared and how they are arranged, the theme on screen, and named clocks.

### State

| Member | Shape | Group | Events | Holds |
| --- | --- | --- | --- | --- |
| `shellStore.layoutDirty` | `boolean` | `view-state` | `panels` | One of the template’s declared panels has been moved, resized or closed — what a "reset layout" control is gated on. False for a template declaring no panels. |
| `shellStore.panelInstances` | `{ id: string, panel: string, inputs: object, title?: string }[]` | `view-state` | `panels` | The panel instances open on screen: which declared panel each is of, and what it was opened with. |
| `shellStore.collapsedLanes` | `string[]` | `view-state` | `panels` | The lanes of the template on screen the person has folded away, by name. |
| `themeStore.currentThemeId` | `string` | `view-state` | `theme` | The id of the theme on screen. |
| `clockStore.clocks` | `Record<string, { at: number \| null, atIso: string, atLabel: string, from: number \| null, to: number \| null, progress: number, playing: boolean, speed: number, loop: boolean, canPlay: boolean }>` | `view-state` | `clock` | Named clocks: a moment being looked at and the playback that moves it. Everything naming a clock follows the same one. `at` is milliseconds since 1970, or null for "show everything". |

### Actions

| Member | Arguments | Group | Ambient | Events | Does |
| --- | --- | --- | --- | --- | --- |
| `shellStore.openTemplatePanel` | `panelId: string` | `view-state` | yes | `panels` | Puts back a declared panel that was closed. |
| `shellStore.closeTemplatePanel` | `panelId: string` | `view-state` | yes | `panels` | Closes a panel the template declared, by its id. |
| `shellStore.openPanel` | `panelId: string`, `inputs?: object`, `options?: { key?: string, title?: string }` | `view-state` | yes | `panels` | Opens another instance of a declared panel with these inputs, or brings forward the one already open with the same inputs (or `key`). |
| `shellStore.closePanel` | `instanceId: string` | `view-state` | yes | `panels` | Closes an instance `openPanel` opened. |
| `shellStore.resetTemplateLayout` | none | `view-state` | yes | `panels` | Puts every declared panel back as the template declared it, reopening the closed ones and unfolding every lane. |
| `shellStore.toggleLane` | `lane: string` | `view-state` | yes | `panels` | Folds a lane away, or brings it back. Its contents stay mounted while folded. |
| `shellStore.setLaneCollapsed` | `lane: string`, `collapsed: boolean` | `view-state` | yes | `panels` | Folds a lane away or brings it back, as said rather than flipped. |
| `shellStore.scrollToId` | `id: string` | `view-state` | yes | — | Scrolls the element with that id into view. |
| `clockStore.play` | `name: string` | `view-state` | yes | `clock` | Plays the clock from where it is, or from the start; does nothing with no range to cross. |
| `clockStore.pause` | `name: string` | `view-state` | yes | `clock` | Stops the clock where it is. |
| `clockStore.toggle` | `name: string` | `view-state` | yes | `clock` | Plays or pauses the clock. |
| `clockStore.seek` | `name: string`, `at: number \| string \| null` | `view-state` | yes | `clock` | Shows that moment, in milliseconds or as an ISO date; null shows everything again. |
| `clockStore.seekProgress` | `name: string`, `fraction: number` | `view-state` | yes | `clock` | Shows the moment that far through the clock’s range, from 0 to 1. |
| `clockStore.setSpeed` | `name: string`, `speed: number` | `view-state` | yes | `clock` | Plays faster or slower; 2 is twice as fast, and 1 the default. |
| `clockStore.setLoop` | `name: string`, `loop: boolean` | `view-state` | yes | `clock` | Starts again at the end rather than stopping. |
| `clockStore.configure` | `name: string`, `settings: { from?: number \| string, to?: number \| string, speed?: number, duration?: number \| string, rate?: number, loop?: boolean }` | `view-state` | yes | `clock` | Sets several things at once: a fixed range, how long the whole range takes to play, or a fixed pace (`rate` 1 is real time). |

### Events

| Event | Changes | When |
| --- | --- | --- |
| `panels` | `shellStore.layoutDirty`, `shellStore.panelInstances`, `shellStore.collapsedLanes` | A declared panel opened, closed, moved or resized, or a lane folded or unfolded. |
| `theme` | `themeStore.currentThemeId` | A different theme is on screen. |
| `clock` | `clockStore.clocks` | A clock moved, started, stopped or was reconfigured. A playing clock changes on every frame it moves. |

## presence

**Presence, version 1.0.0.** Who else is in the space on screen right now, and what this person says about themselves to them. Nothing here is stored: it is said while the person is present and gone when they are not.

### State

| Member | Shape | Group | Events | Holds |
| --- | --- | --- | --- | --- |
| `presenceStore.available` | `boolean` | `presence` | `roster` | There is anybody to be present to here. False in a personal space; gate presence on it rather than drawing an empty roster. |
| `presenceStore.peers` | `PresentAgent[]` | `presence` | `roster` | Every peer known in the space on screen, offline included, most recently seen first. A PresentAgent is { did, name, avatar, tone, focus, activities, availability }. |
| `presenceStore.online` | `PresentAgent[]` | `presence` | `roster` | The peers who are not offline: who is here. |
| `presenceStore.onlineHere` | `PresentAgent[]` | `presence` | `roster`, `address` | The peers on the same page as this person, for a presence strip on a page. |

### Actions

| Member | Arguments | Group | Ambient | Events | Does |
| --- | --- | --- | --- | --- | --- |
| `presenceStore.setAvailability` | `availability: 'available' \| 'busy' \| 'away' \| 'invisible'` | `presence` | no | `roster` | Sets the status said with this person’s presence. Invisible stops saying anything at all. |
| `presenceStore.setActivity` | `activity: { type: string, id?: string, nodeId?: string, [key: string]: unknown }` | `presence` | no | `roster` | Says or replaces what this person is doing — in a call, editing or typing into a record, claiming some work — keyed by its type and id. |
| `presenceStore.clearActivity` | `type: string`, `id?: string` | `presence` | no | `roster` | Withdraws an activity; with no id, every one of that type. |

### Events

| Event | Changes | When |
| --- | --- | --- |
| `roster` | `presenceStore.available`, `presenceStore.peers`, `presenceStore.online`, `presenceStore.onlineHere` | Somebody arrived, left, moved, or changed what they say about themselves. |
| `address` | `presenceStore.onlineHere` | This person moved to another page, so who shares it with them changed. |

## identity

**Identity, version 1.0.0.** Who people are, as their profiles say: the person viewing, the people of the space on screen, and anybody a template has a DID for. Profiles only — never keys, devices or accounts.

### State

| Member | Shape | Group | Events | Holds |
| --- | --- | --- | --- | --- |
| `profileStore.ownProfile` | `{ did: string, name: string, firstName?: string, lastName?: string, handle?: string, bio?: string, avatar?: string, coverImage?: string, location?: object } \| undefined` | `identity` | `profiles` | The viewing person’s own profile. `name` is assembled for display and never empty; ask firstName, lastName or handle whether they have set one. |
| `profileStore.ownProfileLoaded` | `boolean` | `identity` | `profiles` | The own profile has answered, so an empty one is empty rather than not yet arrived. |
| `profileStore.profiles` | `AgentProfileSummary[]` | `identity` | `profiles` | Every profile the host holds, each { did, name, firstName, lastName, handle, bio, avatar, coverImage, location }. Look one up by DID; `$agent` asks for one the host does not hold yet. |
| `spaceStore.memberDids` | `string[]` | `identity` | `members` | The DIDs of everybody in the space on screen, the viewing person included. |

### Events

| Event | Changes | When |
| --- | --- | --- |
| `profiles` | `profileStore.ownProfile`, `profileStore.ownProfileLoaded`, `profileStore.profiles` | A profile arrived or changed. |
| `members` | `spaceStore.memberDids` | Somebody joined or left the space on screen, or a different space is on screen. |

## space-settings

**Space settings, version 1.0.0.** The space a template is drawn in, and what a template may change about it: its look, its defaults, and what this person sees of it. Pinned to the space on screen — a template cannot reach another space through these.

### State

| Member | Shape | Group | Events | Holds |
| --- | --- | --- | --- | --- |
| `spaceStore.currentSpace` | `Space \| null` | `content` | `space` | The Space record of the space on screen (name, description, avatar, coverImage, defaultTemplateId, defaultThemeId, location, and its other fields), or null outside a space. |
| `spaceStore.canAdministerCurrentSpace` | `boolean` | `navigation` | `space` | Whether this person may change what every member of the space on screen sees. Gate a settings control on it, not on who wrote a record. |
| `spaceStore.spaceDefaultTemplateId` | `string` | `space-settings` | `space` | The template members see when they enter the space on screen; empty outside a space. |
| `spaceStore.spaceDefaultThemeId` | `string` | `space-settings` | `space` | The theme members see when they enter the space on screen; empty outside a space. |
| `spaceStore.myModuleSettings` | `{ group: string, groupLabel: string, key: string, label: string, description: string, type: string, options: object[], value: unknown, source: string, set: boolean, locked: boolean, lockedBy: string }[]` | `space-settings` | `settings` | The settings this person has for the capabilities of the space on screen, as rows a screen draws: `value` resolved across every level, `source` the level that decided it, `set` whether this person holds one, `locked` whether a level above forces it. |

### Actions

| Member | Arguments | Group | Ambient | Events | Does |
| --- | --- | --- | --- | --- | --- |
| `spaceStore.setSpaceDefaultTemplate` | `templateId: string` | `space-settings` | no | `space` | Sets the template members see when they enter the space on screen. |
| `spaceStore.setSpaceDefaultTheme` | `themeId: string` | `space-settings` | no | `space` | Sets the theme members see when they enter the space on screen. |
| `spaceStore.updateSpaceImage` | `field: 'avatar' \| 'coverImage'`, `image: File` | `space-settings` | no | `space` | Stores an image the person chose and sets it as the space’s avatar or cover image. |
| `spaceStore.setViewVisible` | `viewId: string`, `visible: boolean` | `space-settings` | no | `space` | Shows or hides a section for this person only, without changing what the community has. The sections `navigation` lists follow (its `space` event). |
| `spaceStore.setModuleVisible` | `moduleId: string`, `visible: boolean` | `space-settings` | no | `space`, `settings` | Shows or hides a module for this person only, without changing what the community runs. |
| `spaceStore.setMyModuleSetting` | `group: string`, `key: string`, `value?: unknown` | `space-settings` | no | `settings` | Sets this person’s own value of one setting in the space on screen; with no value, clears it. |

### Events

| Event | Changes | When |
| --- | --- | --- |
| `space` | `spaceStore.currentSpace`, `spaceStore.canAdministerCurrentSpace`, `spaceStore.spaceDefaultTemplateId`, `spaceStore.spaceDefaultThemeId` | The space on screen changed, or a different one is on screen. |
| `settings` | `spaceStore.myModuleSettings` | A setting changed at any level this person’s value resolves through. |

---

Generated from [`profiles.ts`](../../../packages/schema-system/shared/src/profiles/profiles.ts) by
`pnpm --filter @we/schema-shared generate:profiles`, which the package build runs. Do not edit it by hand.
