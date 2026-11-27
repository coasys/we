import type { CapabilityProfile } from './types';

/**
 * The capability profiles: the host state and actions a template may rely on beyond records,
 * `$query` and declared operations, as named, versioned member lists.
 *
 * ## What is in a profile, and what is not
 *
 * A member is here when a second host could reasonably provide it and built-in templates use it: the
 * address, what is on screen, who is around, who people are, and the settings of the space a
 * template is drawn in. Three kinds of member are left out on purpose:
 *
 * - **Data reads and writes with a neutral equivalent.** A space's task states are its `TaskState`
 *   records, so a `$query` reads them; a post is written by `ops.core.createPost`. A profile that
 *   carried them would make every host restate the data layer. See `HOST_ONLY_EQUIVALENTS`.
 * - **View models that are template work.** A sidebar's ordered rows or a picker's option list are
 *   arrangement, which a template expresses over the profile's plain state.
 * - **WE's own chrome.** Accounts, the runtime, the library, the editor, the shell's own overlays:
 *   members a host's own surfaces need and a portable template has no business naming.
 *
 * Everything outside every profile is WE-host-only: it still works in WE, and the validator says so
 * wherever a template uses one.
 *
 * ## Groups stay the grant
 *
 * A profile says what a host provides; the capability group on each member still decides whether a
 * template may have it. A profile can hold members of several groups (navigation reads the address,
 * which is `view-state`), and the bag is built from groups exactly as before.
 *
 * ## Names
 *
 * A member is written under its profile's namespace — `navigation.params`, `viewState.openPanel`,
 * `spaceSettings.currentSpace` — never under the store a host keeps it in. Stores are how one host is built
 * and may be split or merged; the profile is the contract. So the first segment of a name says
 * whether it travels: a profile namespace does, a store name (`spaceStore.policy`) is WE's alone.
 *
 * Every member here must be classified in the host's template surface with the same group, kind and
 * `ambient` — the app shell's tests hold the two together.
 */
export const CAPABILITY_PROFILES: readonly CapabilityProfile[] = [
  {
    id: 'navigation',
    namespace: 'navigation',
    version: '1.0.0',
    title: 'Navigation',
    description:
      'The address, and moving around it: where the person is, the query on the page, the spaces they hold and the sections of the one on screen, and going somewhere else.',
    members: [
      {
        path: 'navigation.currentPath',
        kind: 'state',
        group: 'view-state',
        shape: 'string',
        description: 'The path on screen, without its query.',
        events: ['address'],
      },
      {
        path: 'navigation.segments',
        kind: 'state',
        group: 'view-state',
        shape: 'string[]',
        description: 'The path split at each "/", empty segments left out.',
        events: ['address'],
      },
      {
        path: 'navigation.templateSegments',
        kind: 'state',
        group: 'view-state',
        shape: 'string[]',
        description:
          'The segments below the prefix the host mounts the template under: the template’s own coordinate space, the same wherever the host puts it.',
        events: ['address'],
      },
      {
        path: 'navigation.params',
        kind: 'state',
        group: 'view-state',
        shape: 'Record<string, string>',
        description:
          'The address’s query parameters, by name, as text. A record’s id is one of these, never a segment.',
        events: ['address'],
      },
      {
        path: 'navigation.navigate',
        kind: 'action',
        group: 'navigation',
        args: [
          { name: 'to', type: 'string' },
          { name: 'options', type: '{ query?: Record<string, string> }', optional: true },
        ],
        description:
          'Goes to a path, resolved against the route the calling node is in: "." is that route, ".." the one above, "./x" a page below, "~/x" from the template’s root, "?q" the page on screen with that query, and an absolute path leaves the template — and may leave the space, putting another one, or none, on screen.',
        ambient: true,
        events: ['address', 'space'],
      },
      {
        path: 'navigation.setParam',
        kind: 'action',
        group: 'view-state',
        args: [
          { name: 'name', type: 'string' },
          { name: 'value', type: 'string | null' },
          { name: 'options', type: '{ push?: boolean }', optional: true },
        ],
        description:
          'Writes one query parameter, or removes it with null. Replaces the history entry unless `push` asks for a new one.',
        ambient: true,
        events: ['address'],
      },
      {
        path: 'navigation.back',
        kind: 'action',
        group: 'navigation',
        args: [],
        description: 'Goes back one history entry. Does nothing at the start of the session’s history.',
        ambient: true,
        events: ['address'],
      },
      {
        path: 'navigation.mySpaces',
        kind: 'state',
        group: 'navigation',
        shape: 'Space[]',
        description:
          'Every space the person holds, as Space records. Ordering and grouping them for a list is the template’s.',
        events: ['spaces'],
      },
      {
        path: 'navigation.spacePath',
        kind: 'state',
        group: 'navigation',
        shape: 'string',
        description:
          'The path the space on screen’s own pages hang off, empty outside a space. For a link that must reach the space from a surface whose "~/" is its own root.',
        events: ['space'],
      },
      {
        path: 'navigation.viewNav',
        kind: 'state',
        group: 'navigation',
        shape: '{ id: string, segment: string, label: string, icon: string, path: string }[]',
        description:
          'The sections of the space on screen, as a navigation strip reads them: those the community enabled, less those this person hid, in order. The same list the host builds the section routes from.',
        events: ['space'],
      },
      {
        path: 'navigation.navigateToSpace',
        kind: 'action',
        group: 'navigation',
        args: [
          { name: 'spaceId', type: 'string' },
          { name: 'view', type: 'string', optional: true },
        ],
        description:
          'Goes to a space the person holds, by its dataset id or its shared id, and optionally to one of its sections.',
        ambient: true,
        events: ['address', 'space'],
      },
      {
        path: 'navigation.openRecordRef',
        kind: 'action',
        group: 'navigation',
        args: [{ name: 'ref', type: 'string' }],
        description:
          'Goes to whatever a record reference names: the space, and the record’s own page in it. A reference naming only a dataset opens the space; one naming a person does nothing.',
        ambient: true,
        events: ['address', 'space'],
      },
    ],
    events: [
      {
        name: 'address',
        changes: ['navigation.currentPath', 'navigation.segments', 'navigation.templateSegments', 'navigation.params'],
        description: 'The address changed: a navigation, a query parameter written, or a step through history.',
      },
      {
        name: 'space',
        changes: ['navigation.spacePath', 'navigation.viewNav'],
        description: 'A different space is on screen, or the sections of this one changed.',
      },
      {
        name: 'spaces',
        changes: ['navigation.mySpaces'],
        description: 'The person joined, left or made a space, or one they hold changed.',
      },
    ],
  },
  {
    id: 'view-state',
    namespace: 'viewState',
    version: '1.0.0',
    title: 'View state',
    description:
      'What the person is looking at that is not the address and is never stored in a space: the panels a template declared, which of them are open and with what, scrolling to something, and named clocks. Every host that draws a template has these, a phone and a page rendered once included.',
    members: [
      {
        path: 'viewState.panelInstances',
        kind: 'state',
        group: 'view-state',
        shape: '{ id: string, panel: string, inputs: object, title?: string }[]',
        description:
          'The panel instances open on screen: which declared panel each is of, and what it was opened with.',
        events: ['panels'],
      },
      {
        path: 'viewState.openTemplatePanel',
        kind: 'action',
        group: 'view-state',
        args: [{ name: 'panelId', type: 'string' }],
        description:
          'Puts back a declared panel that was closed. Not an instance of its own, so `panelInstances` does not change; where the host provides layout, the arrangement does (its `layout` event).',
        ambient: true,
        events: [],
      },
      {
        path: 'viewState.closeTemplatePanel',
        kind: 'action',
        group: 'view-state',
        args: [{ name: 'panelId', type: 'string' }],
        description:
          'Closes a panel the template declared, by its id. Not an instance, so `panelInstances` does not change; where the host provides layout, the arrangement does (its `layout` event).',
        ambient: true,
        events: [],
      },
      {
        path: 'viewState.openPanel',
        kind: 'action',
        group: 'view-state',
        args: [
          { name: 'panelId', type: 'string' },
          { name: 'inputs', type: 'object', optional: true },
          { name: 'options', type: '{ key?: string, title?: string }', optional: true },
        ],
        description:
          'Opens another instance of a declared panel with these inputs, or brings forward the one already open with the same inputs (or `key`).',
        ambient: true,
        events: ['panels'],
      },
      {
        path: 'viewState.closePanel',
        kind: 'action',
        group: 'view-state',
        args: [{ name: 'instanceId', type: 'string' }],
        description: 'Closes an instance `openPanel` opened.',
        ambient: true,
        events: ['panels'],
      },
      {
        path: 'viewState.scrollToId',
        kind: 'action',
        group: 'view-state',
        args: [{ name: 'id', type: 'string' }],
        description: 'Scrolls the element with that id into view.',
        ambient: true,
        events: [],
      },
      {
        path: 'viewState.clocks',
        kind: 'state',
        group: 'view-state',
        shape:
          'Record<string, { at: number | null, atIso: string, atLabel: string, from: number | null, to: number | null, progress: number, playing: boolean, speed: number, loop: boolean, canPlay: boolean }>',
        description:
          'Named clocks: a moment being looked at and the playback that moves it. Everything naming a clock follows the same one. `at` is milliseconds since 1970, or null for "show everything".',
        events: ['clock'],
      },
      {
        path: 'viewState.play',
        kind: 'action',
        group: 'view-state',
        args: [{ name: 'name', type: 'string' }],
        description: 'Plays the clock from where it is, or from the start; does nothing with no range to cross.',
        ambient: true,
        events: ['clock'],
      },
      {
        path: 'viewState.pause',
        kind: 'action',
        group: 'view-state',
        args: [{ name: 'name', type: 'string' }],
        description: 'Stops the clock where it is.',
        ambient: true,
        events: ['clock'],
      },
      {
        path: 'viewState.toggle',
        kind: 'action',
        group: 'view-state',
        args: [{ name: 'name', type: 'string' }],
        description: 'Plays or pauses the clock.',
        ambient: true,
        events: ['clock'],
      },
      {
        path: 'viewState.seek',
        kind: 'action',
        group: 'view-state',
        args: [
          { name: 'name', type: 'string' },
          { name: 'at', type: 'number | string | null' },
        ],
        description: 'Shows that moment, in milliseconds or as an ISO date; null shows everything again.',
        ambient: true,
        events: ['clock'],
      },
      {
        path: 'viewState.seekProgress',
        kind: 'action',
        group: 'view-state',
        args: [
          { name: 'name', type: 'string' },
          { name: 'fraction', type: 'number' },
        ],
        description: 'Shows the moment that far through the clock’s range, from 0 to 1.',
        ambient: true,
        events: ['clock'],
      },
      {
        path: 'viewState.setSpeed',
        kind: 'action',
        group: 'view-state',
        args: [
          { name: 'name', type: 'string' },
          { name: 'speed', type: 'number' },
        ],
        description: 'Plays faster or slower; 2 is twice as fast, and 1 the default.',
        ambient: true,
        events: ['clock'],
      },
      {
        path: 'viewState.setLoop',
        kind: 'action',
        group: 'view-state',
        args: [
          { name: 'name', type: 'string' },
          { name: 'loop', type: 'boolean' },
        ],
        description: 'Starts again at the end rather than stopping.',
        ambient: true,
        events: ['clock'],
      },
      {
        path: 'viewState.configure',
        kind: 'action',
        group: 'view-state',
        args: [
          { name: 'name', type: 'string' },
          {
            name: 'settings',
            type: '{ from?: number | string, to?: number | string, speed?: number, duration?: number | string, rate?: number, loop?: boolean }',
          },
        ],
        description:
          'Sets several things at once: a fixed range, how long the whole range takes to play, or a fixed pace (`rate` 1 is real time).',
        ambient: true,
        events: ['clock'],
      },
    ],
    events: [
      {
        name: 'panels',
        changes: ['viewState.panelInstances'],
        description: 'A panel instance opened or closed.',
      },
      {
        name: 'clock',
        changes: ['viewState.clocks'],
        description:
          'A clock moved, started, stopped or was reconfigured. A playing clock changes on every frame it moves.',
      },
    ],
  },
  {
    id: 'layout',
    namespace: 'layout',
    version: '1.0.0',
    title: 'Layout',
    description:
      'How the panels a template declared are arranged on a screen that docks them in lanes: which lanes are folded away, whether the person has moved anything from where the template put it, and putting it all back. A host that draws panels one at a time, or not at all, leaves this profile out and still provides view-state.',
    members: [
      {
        path: 'layout.layoutDirty',
        kind: 'state',
        group: 'view-state',
        shape: 'boolean',
        description:
          'One of the template’s declared panels has been moved, resized or closed, or a lane folded — what a "reset layout" control is gated on. False for a template declaring no panels.',
        events: ['layout'],
      },
      {
        path: 'layout.collapsedLanes',
        kind: 'state',
        group: 'view-state',
        shape: 'string[]',
        description: 'The lanes of the template on screen the person has folded away, by name.',
        events: ['layout'],
      },
      {
        path: 'layout.toggleLane',
        kind: 'action',
        group: 'view-state',
        args: [{ name: 'lane', type: 'string' }],
        description: 'Folds a lane away, or brings it back. Its contents stay mounted while folded.',
        ambient: true,
        events: ['layout'],
      },
      {
        path: 'layout.setLaneCollapsed',
        kind: 'action',
        group: 'view-state',
        args: [
          { name: 'lane', type: 'string' },
          { name: 'collapsed', type: 'boolean' },
        ],
        description: 'Folds a lane away or brings it back, as said rather than flipped.',
        ambient: true,
        events: ['layout'],
      },
      {
        path: 'layout.resetTemplateLayout',
        kind: 'action',
        group: 'view-state',
        args: [],
        description:
          'Puts every declared panel back as the template declared it, reopening the closed ones and unfolding every lane.',
        ambient: true,
        events: ['layout'],
      },
    ],
    events: [
      {
        name: 'layout',
        changes: ['layout.layoutDirty', 'layout.collapsedLanes'],
        description:
          'A declared panel moved, resized, closed or was put back, or a lane folded or unfolded. Closing or reopening a declared panel through view-state is one of these too.',
      },
    ],
  },
  {
    id: 'presence',
    namespace: 'presence',
    version: '1.0.0',
    title: 'Presence',
    description:
      'Who else is in the space on screen right now, and what this person says about themselves to them. Nothing here is stored: it is said while the person is present and gone when they are not.',
    members: [
      {
        path: 'presence.available',
        kind: 'state',
        group: 'presence',
        shape: 'boolean',
        description:
          'There is anybody to be present to here. False in a personal space; gate presence on it rather than drawing an empty roster.',
        events: ['roster'],
      },
      {
        path: 'presence.peers',
        kind: 'state',
        group: 'presence',
        shape: 'PresentAgent[]',
        description:
          'Every peer known in the space on screen, offline included, most recently seen first. A PresentAgent is { did, name, avatar, tone, focus, activities, availability }.',
        events: ['roster'],
      },
      {
        path: 'presence.online',
        kind: 'state',
        group: 'presence',
        shape: 'PresentAgent[]',
        description: 'The peers who are not offline: who is here.',
        events: ['roster'],
      },
      {
        path: 'presence.onlineHere',
        kind: 'state',
        group: 'presence',
        shape: 'PresentAgent[]',
        description:
          'The peers on the same page as this person, for a presence strip on a page. It changes when they move and when this person does.',
        events: ['roster'],
      },
      {
        path: 'presence.setAvailability',
        kind: 'action',
        group: 'presence',
        args: [{ name: 'availability', type: "'available' | 'busy' | 'away' | 'invisible'" }],
        description: 'Sets the status said with this person’s presence. Invisible stops saying anything at all.',
        events: ['roster'],
      },
      {
        path: 'presence.setActivity',
        kind: 'action',
        group: 'presence',
        args: [{ name: 'activity', type: '{ type: string, id?: string, nodeId?: string, [key: string]: unknown }' }],
        description:
          'Says or replaces what this person is doing — in a call, editing or typing into a record, claiming some work — keyed by its type and id.',
        events: ['roster'],
      },
      {
        path: 'presence.clearActivity',
        kind: 'action',
        group: 'presence',
        args: [
          { name: 'type', type: 'string' },
          { name: 'id', type: 'string', optional: true },
        ],
        description: 'Withdraws an activity; with no id, every one of that type.',
        events: ['roster'],
      },
    ],
    events: [
      {
        name: 'roster',
        changes: ['presence.available', 'presence.peers', 'presence.online', 'presence.onlineHere'],
        description:
          'Somebody arrived, left, moved, or changed what they say about themselves — this person included, so their own move to another page, which changes who shares it, is one too.',
      },
    ],
  },
  {
    id: 'identity',
    namespace: 'identity',
    version: '1.0.0',
    title: 'Identity',
    description:
      'Who people are, as their profiles say: the person viewing, the people of the space on screen, and anybody a template has a DID for — and whom the person viewing has muted and what they have read. Profiles only — never keys, devices or accounts.',
    members: [
      {
        path: 'identity.ownProfile',
        kind: 'state',
        group: 'identity',
        shape:
          '{ did: string, name: string, firstName?: string, lastName?: string, handle?: string, bio?: string, avatar?: string, coverImage?: string, location?: object } | undefined',
        description:
          'The viewing person’s own profile. `name` is assembled for display and never empty; ask firstName, lastName or handle whether they have set one.',
        events: ['profiles'],
      },
      {
        path: 'identity.ownProfileLoaded',
        kind: 'state',
        group: 'identity',
        shape: 'boolean',
        description: 'The own profile has answered, so an empty one is empty rather than not yet arrived.',
        events: ['profiles'],
      },
      {
        path: 'identity.profiles',
        kind: 'state',
        group: 'identity',
        shape: 'AgentProfileSummary[]',
        description:
          'Every profile the host holds, each { did, name, firstName, lastName, handle, bio, avatar, coverImage, location }. Look one up by DID; `$agent` asks for one the host does not hold yet.',
        events: ['profiles'],
      },
      {
        path: 'identity.memberDids',
        kind: 'state',
        group: 'identity',
        shape: 'string[]',
        description: 'The DIDs of everybody in the space on screen, the viewing person included.',
        events: ['members'],
      },
      {
        path: 'identity.mutedDids',
        kind: 'state',
        group: 'content',
        shape: 'string[]',
        description:
          'The DIDs the viewing person has muted, in every space. Theirs alone: a template hides what these people wrote on this person’s screen, and nothing is removed for anybody else.',
        events: ['muted'],
      },
      {
        path: 'identity.readMarkers',
        kind: 'state',
        group: 'content',
        shape: '{ nodeId: string, lastReadAt: string }[]',
        description:
          'When the viewing person last read each node, one row per node they have opened, in every space. Theirs alone, like the mute list. No row means never read. A list rather than a map keyed by node id: find the row with find(identity.readMarkers, { nodeId: … }).',
        events: ['read'],
      },
    ],
    events: [
      {
        name: 'profiles',
        changes: ['identity.ownProfile', 'identity.ownProfileLoaded', 'identity.profiles'],
        description: 'A profile arrived or changed.',
      },
      {
        name: 'members',
        changes: ['identity.memberDids'],
        description: 'Somebody joined or left the space on screen, or a different space is on screen.',
      },
      {
        name: 'muted',
        changes: ['identity.mutedDids'],
        description: 'The viewing person muted or unmuted somebody.',
      },
      {
        name: 'read',
        changes: ['identity.readMarkers'],
        description: 'The viewing person opened a node, so its read marker moved forward.',
      },
    ],
  },
  {
    id: 'space-settings',
    namespace: 'spaceSettings',
    version: '1.0.0',
    title: 'Space settings',
    description:
      'The space a template is drawn in, what this person sees of it, and their own settings for it. Pinned to the space on screen — a template cannot reach another space through these. Changing the space’s own record — its name, pictures and defaults — is the space’s operations’, not this profile’s.',
    members: [
      {
        path: 'spaceSettings.currentSpace',
        kind: 'state',
        group: 'content',
        shape: 'Space | null',
        description:
          'The Space record of the space on screen (name, description, avatar, coverImage, defaultTemplateId, defaultThemeId, location, and its other fields), or null outside a space.',
        events: ['space'],
      },
      {
        path: 'spaceSettings.canAdministerCurrentSpace',
        kind: 'state',
        group: 'navigation',
        shape: 'boolean',
        description:
          'Whether this person may change what every member of the space on screen sees. Gate a settings control on it, not on who wrote a record.',
        events: ['space'],
      },
      {
        path: 'spaceSettings.spaceDefaultTemplateId',
        kind: 'state',
        group: 'space-settings',
        shape: 'string',
        description: 'The template members see when they enter the space on screen; empty outside a space.',
        events: ['space'],
      },
      {
        path: 'spaceSettings.spaceDefaultThemeId',
        kind: 'state',
        group: 'space-settings',
        shape: 'string',
        description: 'The theme members see when they enter the space on screen; empty outside a space.',
        events: ['space'],
      },
      {
        path: 'spaceSettings.myModuleSettings',
        kind: 'state',
        group: 'space-settings',
        shape:
          '{ group: string, groupLabel: string, key: string, label: string, description: string, type: string, options: object[], value: unknown, source: string, set: boolean, locked: boolean, lockedBy: string }[]',
        description:
          'The settings this person has for the capabilities of the space on screen, as rows a screen draws: `value` resolved across every level, `source` the level that decided it, `set` whether this person holds one, `locked` whether a level above forces it.',
        events: ['settings'],
      },
      {
        path: 'spaceSettings.prepareSpaceImage',
        kind: 'action',
        group: 'space-settings',
        args: [
          { name: 'field', type: "'avatar' | 'coverImage'" },
          { name: 'image', type: 'File' },
        ],
        description:
          'Makes a picture the person chose into what the space’s record stores for that field — sized for it — and answers with it, for `ops.core.setSpaceImage` to write. Stores nothing itself.',
        events: [],
      },
      {
        path: 'spaceSettings.setViewVisible',
        kind: 'action',
        group: 'space-settings',
        args: [
          { name: 'viewId', type: 'string' },
          { name: 'visible', type: 'boolean' },
        ],
        description:
          'Shows or hides a section for this person only, without changing what the community has. The sections `navigation` lists follow (its `space` event).',
        events: ['space'],
      },
      {
        path: 'spaceSettings.setModuleVisible',
        kind: 'action',
        group: 'space-settings',
        args: [
          { name: 'moduleId', type: 'string' },
          { name: 'visible', type: 'boolean' },
        ],
        description:
          'Shows or hides a module for this person only, without changing what the community runs. Nothing else in a profile reads which modules this person hides, so no event follows.',
        events: [],
      },
      {
        path: 'spaceSettings.setMyModuleSetting',
        kind: 'action',
        group: 'space-settings',
        args: [
          { name: 'group', type: 'string' },
          { name: 'key', type: 'string' },
          { name: 'value', type: 'unknown', optional: true },
        ],
        description: 'Sets this person’s own value of one setting in the space on screen; with no value, clears it.',
        events: ['settings'],
      },
    ],
    events: [
      {
        name: 'space',
        changes: [
          'spaceSettings.currentSpace',
          'spaceSettings.canAdministerCurrentSpace',
          'spaceSettings.spaceDefaultTemplateId',
          'spaceSettings.spaceDefaultThemeId',
        ],
        description: 'The space on screen changed, or a different one is on screen.',
      },
      {
        name: 'settings',
        changes: ['spaceSettings.myModuleSettings'],
        description: 'A setting changed at any level this person’s value resolves through.',
      },
    ],
  },
  {
    id: 'appearance',
    namespace: 'appearance',
    version: '1.0.0',
    title: 'Appearance',
    description:
      'Which template and theme this person is looking at, and what they may choose between: the templates and themes on offer here, the ones on screen, switching between them, and this person’s own choice for the space on screen. Choosing is always this person’s own — it changes what they see and nothing anybody else does. A space’s defaults are its record’s, and change through operations.',
    members: [
      {
        path: 'appearance.switcherGroups',
        kind: 'state',
        group: 'appearance',
        shape: '{ label: string, items: { id: string, name: string, icon: string, editable: boolean }[] }[]',
        description:
          'The templates this person may switch to here, grouped as a switcher lists them: the space’s own, this person’s, and those the host brings. A row’s `id` is the host’s key for that choice — what `switchTemplate` takes and `currentSwitcherId` names — and `editable` says whether it can be changed in place rather than copied first.',
        events: ['templates'],
      },
      {
        path: 'appearance.currentSwitcherId',
        kind: 'state',
        group: 'appearance',
        shape: 'string',
        description: 'The id of the switcher row for the template on screen.',
        events: ['template'],
      },
      {
        path: 'appearance.templateOverrideOptions',
        kind: 'state',
        group: 'appearance',
        shape: '{ label: string, value: string }[]',
        description:
          'What this person may choose to see in the space on screen instead of its default template, as a picker lists it: following the space, following their own default, then every template they have. A `value` is what `setSpaceTemplateOverride` takes.',
        events: ['templates'],
      },
      {
        path: 'appearance.builtInThemes',
        kind: 'state',
        group: 'appearance',
        shape: 'Theme[]',
        description: 'The themes the host brings itself. A Theme is { id, name, … }.',
        events: ['themes'],
      },
      {
        path: 'appearance.installedThemes',
        kind: 'state',
        group: 'appearance',
        shape: 'Theme[]',
        description: 'The themes this person keeps for themselves, which follow them into every space.',
        events: ['themes'],
      },
      {
        path: 'appearance.spaceThemes',
        kind: 'state',
        group: 'appearance',
        shape: 'Theme[]',
        description: 'The themes the space on screen holds; empty outside a space.',
        events: ['themes'],
      },
      {
        path: 'appearance.themeOverrideOptions',
        kind: 'state',
        group: 'appearance',
        shape: '{ label: string, value: string }[]',
        description:
          'What this person may choose to see in the space on screen instead of its default theme, as `templateOverrideOptions` lists templates. A `value` is what `setSpaceThemeOverride` takes.',
        events: ['themes'],
      },
      {
        path: 'appearance.currentThemeId',
        kind: 'state',
        group: 'view-state',
        shape: 'string',
        description:
          'The id of the theme on screen: this person’s choice for the space on screen where they made one; else the space’s default or a theme the template on screen brings, the space’s first when that template is the space’s own default; else their own default.',
        events: ['theme'],
      },
      {
        path: 'appearance.spaceThemePinned',
        kind: 'state',
        group: 'appearance',
        shape: 'boolean',
        description:
          'This person has chosen a theme for the space on screen other than the one that would show anyway — whether a "use the space’s theme" control has anything to undo.',
        events: ['theme'],
      },
      {
        path: 'appearance.switchTemplate',
        kind: 'action',
        group: 'appearance',
        args: [{ name: 'id', type: 'string' }],
        description:
          'Shows the template a switcher row offers, by the row’s id, keeping the section on screen where the template has it — and the theme it brings, where it brings one. For now only: entering the space again shows what its default and this person’s choice say.',
        events: ['template', 'theme'],
      },
      {
        path: 'appearance.setSpaceTemplateOverride',
        kind: 'action',
        group: 'appearance',
        args: [{ name: 'value', type: 'string' }],
        description:
          'Chooses what this person sees in the space on screen instead of its default template, by a `templateOverrideOptions` value, and shows it, with the theme it brings where it brings one. Theirs alone: nobody else’s screen changes.',
        events: ['template', 'templates', 'theme'],
      },
      {
        path: 'appearance.applyTheme',
        kind: 'action',
        group: 'appearance',
        args: [{ name: 'themeId', type: 'string' }],
        description:
          'Shows a theme where this person is: chosen for the space on screen, or as their own default outside a space.',
        events: ['theme'],
      },
      {
        path: 'appearance.clearSpaceThemePin',
        kind: 'action',
        group: 'appearance',
        args: [],
        description: 'Withdraws this person’s choice of theme for the space on screen, so its default shows again.',
        events: ['theme'],
      },
      {
        path: 'appearance.setSpaceThemeOverride',
        kind: 'action',
        group: 'appearance',
        args: [{ name: 'value', type: 'string' }],
        description:
          'Chooses what this person sees in the space on screen instead of its default theme, by a `themeOverrideOptions` value, and shows it.',
        events: ['theme', 'themes'],
      },
    ],
    events: [
      {
        name: 'templates',
        changes: ['appearance.switcherGroups', 'appearance.templateOverrideOptions'],
        description:
          'The templates on offer changed — a different space is on screen, or one was added or removed — or what the space and this person default to did.',
      },
      {
        name: 'template',
        changes: ['appearance.currentSwitcherId'],
        description: 'A different template is on screen.',
      },
      {
        name: 'themes',
        changes: [
          'appearance.builtInThemes',
          'appearance.installedThemes',
          'appearance.spaceThemes',
          'appearance.themeOverrideOptions',
        ],
        description:
          'The themes on offer changed — a different space is on screen, or one was added or removed — or what the space and this person default to did.',
      },
      {
        name: 'theme',
        changes: ['appearance.currentThemeId', 'appearance.spaceThemePinned'],
        description: 'A different theme is on screen, or this person’s choice for the space on screen changed.',
      },
    ],
  },
];
