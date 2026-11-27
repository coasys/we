# Capability profiles: members

Every member of every profile, with its shape, its arguments, its capability group and the change
events it is part of. The normative rules for reading this listing are in [the README](README.md);
the same data, for tooling, is [`profiles.json`](profiles.json).

| Profile | Version | Members |
| --- | --- | --- |
| [Navigation](#navigation) | 1.0.0 | 12 |
| [View state](#view-state) | 1.0.0 | 15 |
| [Layout](#layout) | 1.0.0 | 5 |
| [Presence](#presence) | 1.0.0 | 7 |
| [Identity](#identity) | 1.0.0 | 6 |
| [Space settings](#space-settings) | 1.0.0 | 9 |
| [Appearance](#appearance) | 1.0.0 | 14 |

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

**View state, version 1.0.0.** What the person is looking at that is not the address and is never stored in a space: the panels a template declared, which of them are open and with what, scrolling to something, and named clocks. Every host that draws a template has these, a phone and a page rendered once included.

### State

| Member | Shape | Group | Events | Holds |
| --- | --- | --- | --- | --- |
| `shellStore.panelInstances` | `{ id: string, panel: string, inputs: object, title?: string }[]` | `view-state` | `panels` | The panel instances open on screen: which declared panel each is of, and what it was opened with. |
| `clockStore.clocks` | `Record<string, { at: number \| null, atIso: string, atLabel: string, from: number \| null, to: number \| null, progress: number, playing: boolean, speed: number, loop: boolean, canPlay: boolean }>` | `view-state` | `clock` | Named clocks: a moment being looked at and the playback that moves it. Everything naming a clock follows the same one. `at` is milliseconds since 1970, or null for "show everything". |

### Actions

| Member | Arguments | Group | Ambient | Events | Does |
| --- | --- | --- | --- | --- | --- |
| `shellStore.openTemplatePanel` | `panelId: string` | `view-state` | yes | — | Puts back a declared panel that was closed. Not an instance of its own, so `panelInstances` does not change; where the host provides layout, the arrangement does (its `layout` event). |
| `shellStore.closeTemplatePanel` | `panelId: string` | `view-state` | yes | — | Closes a panel the template declared, by its id. Not an instance, so `panelInstances` does not change; where the host provides layout, the arrangement does (its `layout` event). |
| `shellStore.openPanel` | `panelId: string`, `inputs?: object`, `options?: { key?: string, title?: string }` | `view-state` | yes | `panels` | Opens another instance of a declared panel with these inputs, or brings forward the one already open with the same inputs (or `key`). |
| `shellStore.closePanel` | `instanceId: string` | `view-state` | yes | `panels` | Closes an instance `openPanel` opened. |
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
| `panels` | `shellStore.panelInstances` | A panel instance opened or closed. |
| `clock` | `clockStore.clocks` | A clock moved, started, stopped or was reconfigured. A playing clock changes on every frame it moves. |

## layout

**Layout, version 1.0.0.** How the panels a template declared are arranged on a screen that docks them in lanes: which lanes are folded away, whether the person has moved anything from where the template put it, and putting it all back. A host that draws panels one at a time, or not at all, leaves this profile out and still provides view-state.

### State

| Member | Shape | Group | Events | Holds |
| --- | --- | --- | --- | --- |
| `shellStore.layoutDirty` | `boolean` | `view-state` | `layout` | One of the template’s declared panels has been moved, resized or closed, or a lane folded — what a "reset layout" control is gated on. False for a template declaring no panels. |
| `shellStore.collapsedLanes` | `string[]` | `view-state` | `layout` | The lanes of the template on screen the person has folded away, by name. |

### Actions

| Member | Arguments | Group | Ambient | Events | Does |
| --- | --- | --- | --- | --- | --- |
| `shellStore.toggleLane` | `lane: string` | `view-state` | yes | `layout` | Folds a lane away, or brings it back. Its contents stay mounted while folded. |
| `shellStore.setLaneCollapsed` | `lane: string`, `collapsed: boolean` | `view-state` | yes | `layout` | Folds a lane away or brings it back, as said rather than flipped. |
| `shellStore.resetTemplateLayout` | none | `view-state` | yes | `layout` | Puts every declared panel back as the template declared it, reopening the closed ones and unfolding every lane. |

### Events

| Event | Changes | When |
| --- | --- | --- |
| `layout` | `shellStore.layoutDirty`, `shellStore.collapsedLanes` | A declared panel moved, resized, closed or was put back, or a lane folded or unfolded. Closing or reopening a declared panel through view-state is one of these too. |

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

**Identity, version 1.0.0.** Who people are, as their profiles say: the person viewing, the people of the space on screen, and anybody a template has a DID for — and whom the person viewing has muted and what they have read. Profiles only — never keys, devices or accounts.

### State

| Member | Shape | Group | Events | Holds |
| --- | --- | --- | --- | --- |
| `profileStore.ownProfile` | `{ did: string, name: string, firstName?: string, lastName?: string, handle?: string, bio?: string, avatar?: string, coverImage?: string, location?: object } \| undefined` | `identity` | `profiles` | The viewing person’s own profile. `name` is assembled for display and never empty; ask firstName, lastName or handle whether they have set one. |
| `profileStore.ownProfileLoaded` | `boolean` | `identity` | `profiles` | The own profile has answered, so an empty one is empty rather than not yet arrived. |
| `profileStore.profiles` | `AgentProfileSummary[]` | `identity` | `profiles` | Every profile the host holds, each { did, name, firstName, lastName, handle, bio, avatar, coverImage, location }. Look one up by DID; `$agent` asks for one the host does not hold yet. |
| `spaceStore.memberDids` | `string[]` | `identity` | `members` | The DIDs of everybody in the space on screen, the viewing person included. |
| `spaceStore.mutedDids` | `string[]` | `content` | `muted` | The DIDs the viewing person has muted, in every space. Theirs alone: a template hides what these people wrote on this person’s screen, and nothing is removed for anybody else. |
| `spaceStore.readMarkers` | `{ nodeId: string, lastReadAt: string }[]` | `content` | `read` | When the viewing person last read each node, one row per node they have opened, in every space. Theirs alone, like the mute list. No row means never read. A list rather than a map keyed by node id: find the row with find(spaceStore.readMarkers, { nodeId: … }). |

### Events

| Event | Changes | When |
| --- | --- | --- |
| `profiles` | `profileStore.ownProfile`, `profileStore.ownProfileLoaded`, `profileStore.profiles` | A profile arrived or changed. |
| `members` | `spaceStore.memberDids` | Somebody joined or left the space on screen, or a different space is on screen. |
| `muted` | `spaceStore.mutedDids` | The viewing person muted or unmuted somebody. |
| `read` | `spaceStore.readMarkers` | The viewing person opened a node, so its read marker moved forward. |

## space-settings

**Space settings, version 1.0.0.** The space a template is drawn in, what this person sees of it, and their own settings for it. Pinned to the space on screen — a template cannot reach another space through these. Changing the space’s own record — its name, pictures and defaults — is the space’s operations’, not this profile’s.

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
| `spaceStore.prepareSpaceImage` | `field: 'avatar' \| 'coverImage'`, `image: File` | `space-settings` | no | — | Makes a picture the person chose into what the space’s record stores for that field — sized for it — and answers with it, for `ops.core.setSpaceImage` to write. Stores nothing itself. |
| `spaceStore.setViewVisible` | `viewId: string`, `visible: boolean` | `space-settings` | no | `space` | Shows or hides a section for this person only, without changing what the community has. The sections `navigation` lists follow (its `space` event). |
| `spaceStore.setModuleVisible` | `moduleId: string`, `visible: boolean` | `space-settings` | no | — | Shows or hides a module for this person only, without changing what the community runs. Nothing else in a profile reads which modules this person hides, so no event follows. |
| `spaceStore.setMyModuleSetting` | `group: string`, `key: string`, `value?: unknown` | `space-settings` | no | `settings` | Sets this person’s own value of one setting in the space on screen; with no value, clears it. |

### Events

| Event | Changes | When |
| --- | --- | --- |
| `space` | `spaceStore.currentSpace`, `spaceStore.canAdministerCurrentSpace`, `spaceStore.spaceDefaultTemplateId`, `spaceStore.spaceDefaultThemeId` | The space on screen changed, or a different one is on screen. |
| `settings` | `spaceStore.myModuleSettings` | A setting changed at any level this person’s value resolves through. |

## appearance

**Appearance, version 1.0.0.** Which template and theme this person is looking at, and what they may choose between: the templates and themes on offer here, the ones on screen, switching between them, and this person’s own choice for the space on screen. Choosing is always this person’s own — it changes what they see and nothing anybody else does. A space’s defaults are its record’s, and change through operations.

### State

| Member | Shape | Group | Events | Holds |
| --- | --- | --- | --- | --- |
| `templateStore.switcherGroups` | `{ label: string, items: { id: string, name: string, icon: string, editable: boolean }[] }[]` | `appearance` | `templates` | The templates this person may switch to here, grouped as a switcher lists them: the space’s own, this person’s, and those the host brings. A row’s `id` is the host’s key for that choice — what `switchTemplate` takes and `currentSwitcherId` names — and `editable` says whether it can be changed in place rather than copied first. |
| `templateStore.currentSwitcherId` | `string` | `appearance` | `template` | The id of the switcher row for the template on screen. |
| `templateStore.templateOverrideOptions` | `{ label: string, value: string }[]` | `appearance` | `templates` | What this person may choose to see in the space on screen instead of its default template, as a picker lists it: following the space, following their own default, then every template they have. A `value` is what `setSpaceTemplateOverride` takes. |
| `themeStore.builtInThemes` | `Theme[]` | `appearance` | `themes` | The themes the host brings itself. A Theme is { id, name, … }. |
| `themeStore.installedThemes` | `Theme[]` | `appearance` | `themes` | The themes this person keeps for themselves, which follow them into every space. |
| `themeStore.spaceThemes` | `Theme[]` | `appearance` | `themes` | The themes the space on screen holds; empty outside a space. |
| `themeStore.themeOverrideOptions` | `{ label: string, value: string }[]` | `appearance` | `themes` | What this person may choose to see in the space on screen instead of its default theme, as `templateOverrideOptions` lists templates. A `value` is what `setSpaceThemeOverride` takes. |
| `themeStore.currentThemeId` | `string` | `view-state` | `theme` | The id of the theme on screen: this person’s choice for the space on screen where they made one; else the space’s default or a theme the template on screen brings, the space’s first when that template is the space’s own default; else their own default. |
| `themeStore.spaceThemePinned` | `boolean` | `appearance` | `theme` | This person has chosen a theme for the space on screen other than the one that would show anyway — whether a "use the space’s theme" control has anything to undo. |

### Actions

| Member | Arguments | Group | Ambient | Events | Does |
| --- | --- | --- | --- | --- | --- |
| `templateStore.switchTemplate` | `id: string` | `appearance` | no | `template`, `theme` | Shows the template a switcher row offers, by the row’s id, keeping the section on screen where the template has it — and the theme it brings, where it brings one. For now only: entering the space again shows what its default and this person’s choice say. |
| `templateStore.setSpaceTemplateOverride` | `value: string` | `appearance` | no | `template`, `templates`, `theme` | Chooses what this person sees in the space on screen instead of its default template, by a `templateOverrideOptions` value, and shows it, with the theme it brings where it brings one. Theirs alone: nobody else’s screen changes. |
| `themeStore.applyTheme` | `themeId: string` | `appearance` | no | `theme` | Shows a theme where this person is: chosen for the space on screen, or as their own default outside a space. |
| `themeStore.clearSpaceThemePin` | none | `appearance` | no | `theme` | Withdraws this person’s choice of theme for the space on screen, so its default shows again. |
| `themeStore.setSpaceThemeOverride` | `value: string` | `appearance` | no | `theme`, `themes` | Chooses what this person sees in the space on screen instead of its default theme, by a `themeOverrideOptions` value, and shows it. |

### Events

| Event | Changes | When |
| --- | --- | --- |
| `templates` | `templateStore.switcherGroups`, `templateStore.templateOverrideOptions` | The templates on offer changed — a different space is on screen, or one was added or removed — or what the space and this person default to did. |
| `template` | `templateStore.currentSwitcherId` | A different template is on screen. |
| `themes` | `themeStore.builtInThemes`, `themeStore.installedThemes`, `themeStore.spaceThemes`, `themeStore.themeOverrideOptions` | The themes on offer changed — a different space is on screen, or one was added or removed — or what the space and this person default to did. |
| `theme` | `themeStore.currentThemeId`, `themeStore.spaceThemePinned` | A different theme is on screen, or this person’s choice for the space on screen changed. |

---

Generated from [`profiles.ts`](../../../packages/schema-system/shared/src/profiles/profiles.ts) by
`pnpm --filter @we/schema-shared generate:profiles`, which the package build runs. Do not edit it by hand.
