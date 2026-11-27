/**
 * Capability-profile vector inputs: a world, an address, and one action of a profile — or none, for
 * what a host reads out of its world. Recorded against WE's own stores (`profileHost.ts` in
 * app-shell), they are what a second host runs to show it provides the same profiles; the format is
 * `docs/spec/profiles/README.md`'s.
 *
 * A case names only profile members and plain values. A host's own words for a thing (a section's
 * label, a moment's label), the ids it mints and the bytes it stores an image as are not in them.
 */
import type { ProfileCaseInput, ProfileWorld, WorldRecord } from '../../../../app-shell/tests/support/profileHost.ts';

export interface ProfileCase extends Omit<ProfileCaseInput, 'world'> {
  /** The world the case's host starts with, by its name in {@link PROFILE_WORLDS}. */
  world: string;
  /** The profile the case is about. Its events are recorded for every profile. */
  profile: 'navigation' | 'view-state' | 'presence' | 'identity' | 'space-settings';
  /** What the case shows, in a sentence. */
  note: string;
}

const ME = 'did:example:me';
const ADA = 'did:example:ada';
const BO = 'did:example:bo';

const space = (id: string, fields: Record<string, unknown>): WorldRecord => ({
  entity: 'Space',
  id: `urn:example:space-${id}`,
  fields,
});

/** The world most cases share: two shared spaces, a personal one, three people, two of them here. */
const COMMUNITY: ProfileWorld = {
  me: ME,
  profiles: [
    { did: ME, firstName: 'Mae', lastName: 'Rivers', handle: 'mae' },
    { did: ADA, firstName: 'Ada', lastName: 'Lind', handle: 'ada', bio: 'Grows beans.' },
    { did: BO, handle: 'bo' },
  ],
  spaces: [
    {
      id: 'garden',
      name: 'Garden',
      shared: true,
      members: [ADA, BO],
      records: [
        space('garden', {
          name: 'Garden',
          description: 'Plots and seeds',
          enabledViews: ['about', 'cards', 'boards'],
          moduleSettings: { reader: { density: 'roomy' } },
        }),
      ],
    },
    {
      id: 'orchard',
      name: 'Orchard',
      shared: true,
      members: [ADA],
      records: [space('orchard', { name: 'Orchard', description: 'Trees', enabledViews: ['about', 'cards'] })],
    },
    {
      id: 'notebook',
      name: 'Notebook',
      records: [space('notebook', { name: 'Notebook', description: 'Mine alone', enabledViews: ['about'] })],
    },
  ],
  own: [
    { entity: 'MutedAgent', id: 'urn:example:muted-bo', fields: { did: BO } },
    {
      entity: 'ReadMarker',
      id: 'urn:example:read-post',
      fields: { nodeId: 'urn:example:post', spaceUuid: 'garden', lastReadAt: '2026-11-01T10:00:00.000Z' },
    },
  ],
  peers: [
    { did: ADA, availability: 'busy', focus: { space: 'garden', path: '/space/garden/cards' } },
    {
      did: BO,
      availability: 'available',
      focus: { space: 'garden', path: '/space/garden/about' },
      activities: [{ type: 'typing', id: 'urn:example:post' }],
    },
  ],
  modules: [
    {
      id: 'reader',
      name: 'Reader',
      settings: [
        { key: 'compact', label: 'Compact rows', type: 'boolean', default: false, levels: ['agent-in-space'] },
        {
          key: 'density',
          label: 'Density',
          type: 'enum',
          options: [
            { label: 'Roomy', value: 'roomy' },
            { label: 'Tight', value: 'tight' },
          ],
          default: 'tight',
          levels: ['space', 'agent-in-space'],
        },
      ],
    },
  ],
  panels: [
    { id: 'inspector', title: 'Inspector', home: 'side', order: 0, node: { type: 'span' } },
    { id: 'outline', title: 'Outline', home: 'side', order: 1, node: { type: 'span' } },
  ],
};

const ADDRESS = ['routeStore.currentPath', 'routeStore.segments', 'routeStore.templateSegments', 'routeStore.params'];
const SPACE = ['spaceStore.spacePath', 'spaceStore.viewNav'];
const PANELS = ['shellStore.layoutDirty', 'shellStore.panelInstances', 'shellStore.collapsedLanes'];
const ROSTER = ['presenceStore.available', 'presenceStore.peers', 'presenceStore.online', 'presenceStore.onlineHere'];
const SETTINGS = [
  'spaceStore.currentSpace',
  'spaceStore.canAdministerCurrentSpace',
  'spaceStore.spaceDefaultTemplateId',
  'spaceStore.spaceDefaultThemeId',
];
const CLOCKS = ['clockStore.clocks'];
const RANGE = { action: 'clockStore.configure', args: ['main', { from: 0, to: 60000 }] };

/** The worlds the cases start from, by name. */
export const PROFILE_WORLDS: Record<string, ProfileWorld> = {
  community: COMMUNITY,
  // Somebody alone with a space of their own, who has published nothing about themselves.
  unnamed: { me: ME, profiles: [{ did: ME }], spaces: [COMMUNITY.spaces![2]] },
};

type Shape = Omit<ProfileCase, 'world'> & { world?: string };
const c = (shape: Shape): ProfileCase => ({ world: 'community', ...shape });

export const PROFILE_CASES: ProfileCase[] = [
  // ── navigation ────────────────────────────────────────────────────────────
  c({
    id: 'navigation.read-address',
    profile: 'navigation',
    note: 'The address read apart: its path, segments, the segments below the space, its query.',
    address: '/space/garden/cards?sort=new&id=urn:example:post',
    observe: [...ADDRESS, ...SPACE, 'spaceStore.mySpaces'],
  }),
  c({
    id: 'navigation.read-outside-a-space',
    profile: 'navigation',
    note: 'Outside a space the template segments are the whole path, and there is no space path.',
    address: '/settings',
    observe: [...ADDRESS, 'spaceStore.spacePath'],
  }),
  c({
    id: 'navigation.navigate-from-root',
    profile: 'navigation',
    note: '"~/x" goes from the template’s root, the space it is mounted under.',
    address: '/space/garden/about',
    observe: ADDRESS,
    action: 'routeStore.navigate',
    args: ['~/cards'],
  }),
  c({
    id: 'navigation.navigate-with-query',
    profile: 'navigation',
    note: 'A record id goes in the query, written so it reads back exactly.',
    address: '/space/garden/about',
    observe: ADDRESS,
    action: 'routeStore.navigate',
    args: ['~/record/CollectionBlock', { query: { id: 'urn:example:post' } }],
  }),
  c({
    id: 'navigation.navigate-query-only',
    profile: 'navigation',
    note: '"?q" is the page on screen with that query.',
    address: '/space/garden/cards',
    observe: ADDRESS,
    action: 'routeStore.navigate',
    args: ['?sort=old'],
  }),
  c({
    id: 'navigation.navigate-up',
    profile: 'navigation',
    note: '".." from the root route stays at the root: a template cannot climb out of its space that way.',
    address: '/space/garden/cards',
    observe: ADDRESS,
    action: 'routeStore.navigate',
    args: ['..'],
  }),
  c({
    id: 'navigation.navigate-absolute',
    profile: 'navigation',
    note: 'An absolute path leaves the template.',
    address: '/space/garden/cards',
    observe: [...ADDRESS, ...SPACE],
    action: 'routeStore.navigate',
    args: ['/settings'],
  }),
  c({
    id: 'navigation.navigate-to-where-it-is',
    profile: 'navigation',
    note: 'Going to the page on screen changes nothing and says nothing.',
    address: '/space/garden/cards',
    observe: ADDRESS,
    action: 'routeStore.navigate',
    args: ['/space/garden/cards'],
  }),
  c({
    id: 'navigation.set-param',
    profile: 'navigation',
    note: 'One query parameter written; the path is unchanged.',
    address: '/space/garden/cards?sort=new',
    observe: ADDRESS,
    action: 'routeStore.setParam',
    args: ['type', 'posts'],
  }),
  c({
    id: 'navigation.set-param-null',
    profile: 'navigation',
    note: 'null removes the parameter.',
    address: '/space/garden/cards?sort=new&type=posts',
    observe: ADDRESS,
    action: 'routeStore.setParam',
    args: ['sort', null],
  }),
  c({
    id: 'navigation.set-param-same',
    profile: 'navigation',
    note: 'Writing the value a parameter already holds changes nothing and says nothing.',
    address: '/space/garden/cards?sort=new',
    observe: ADDRESS,
    action: 'routeStore.setParam',
    args: ['sort', 'new'],
  }),
  c({
    id: 'navigation.set-param-push',
    profile: 'navigation',
    note: 'With push, the write is a history entry of its own: Back returns to the query before it.',
    address: '/space/garden/cards?type=posts',
    setup: [{ action: 'routeStore.setParam', args: ['type', 'events', { push: true }] }],
    observe: ADDRESS,
    action: 'routeStore.back',
    args: [],
  }),
  c({
    id: 'navigation.back',
    profile: 'navigation',
    note: 'Back goes to the entry before, query and all.',
    address: '/space/garden/cards',
    history: ['/space/garden/about?tab=people'],
    observe: [...ADDRESS, ...SPACE],
    action: 'routeStore.back',
    args: [],
  }),
  c({
    id: 'navigation.navigate-to-space',
    profile: 'navigation',
    note: 'Going to another space carries the section across when that space has it, and its sections follow.',
    address: '/space/garden/cards',
    observe: [...ADDRESS, ...SPACE],
    action: 'spaceStore.navigateToSpace',
    args: ['orchard'],
  }),
  c({
    id: 'navigation.navigate-to-space-without-the-section',
    profile: 'navigation',
    note: 'A section the destination does not have is not carried: the space itself is opened.',
    address: '/space/garden/boards',
    observe: [...ADDRESS, ...SPACE],
    action: 'spaceStore.navigateToSpace',
    args: ['orchard'],
  }),
  c({
    id: 'navigation.navigate-to-space-section',
    profile: 'navigation',
    note: 'A named section is always taken.',
    address: '/space/garden/cards',
    observe: [...ADDRESS, ...SPACE],
    action: 'spaceStore.navigateToSpace',
    args: ['orchard', 'about'],
  }),
  c({
    id: 'navigation.open-record-ref',
    profile: 'navigation',
    note: 'A record reference opens its space, and the record’s own page in it.',
    address: '/space/garden/cards',
    observe: [...ADDRESS, ...SPACE],
    action: 'spaceStore.openRecordRef',
    args: ['we:n:orchard/CollectionBlock/urn:example:post'],
  }),
  c({
    id: 'navigation.open-dataset-ref',
    profile: 'navigation',
    note: 'A reference naming only a space opens the space.',
    address: '/space/garden/cards',
    observe: [...ADDRESS, ...SPACE],
    action: 'spaceStore.openRecordRef',
    args: ['we:n:orchard'],
  }),
  c({
    id: 'navigation.open-person-ref',
    profile: 'navigation',
    note: 'A reference naming a person goes nowhere.',
    address: '/space/garden/cards',
    observe: ADDRESS,
    action: 'spaceStore.openRecordRef',
    args: [`we:agent/${ADA}`],
  }),

  // ── view-state ────────────────────────────────────────────────────────────
  c({
    id: 'view-state.read-declared',
    profile: 'view-state',
    note: 'A template’s declared panels, untouched: nothing moved, no extra instances, no lane folded.',
    address: '/space/garden',
    observe: PANELS,
  }),
  c({
    id: 'view-state.close-template-panel',
    profile: 'view-state',
    note: 'Closing a declared panel is a change to the layout the template declared.',
    address: '/space/garden',
    observe: PANELS,
    action: 'shellStore.closeTemplatePanel',
    args: ['inspector'],
  }),
  c({
    id: 'view-state.open-template-panel',
    profile: 'view-state',
    note: 'Putting a closed declared panel back.',
    address: '/space/garden',
    setup: [{ action: 'shellStore.closeTemplatePanel', args: ['inspector'] }],
    observe: PANELS,
    action: 'shellStore.openTemplatePanel',
    args: ['inspector'],
  }),
  c({
    id: 'view-state.open-panel',
    profile: 'view-state',
    note: 'Another instance of a declared panel, with what it was opened with.',
    address: '/space/garden',
    observe: PANELS,
    action: 'shellStore.openPanel',
    args: ['inspector', { record: 'urn:example:post' }, { title: 'The post' }],
  }),
  c({
    id: 'view-state.open-panel-again',
    profile: 'view-state',
    note: 'The same inputs again bring the open instance forward rather than opening a second.',
    address: '/space/garden',
    setup: [{ action: 'shellStore.openPanel', args: ['inspector', { record: 'urn:example:post' }] }],
    observe: PANELS,
    action: 'shellStore.openPanel',
    args: ['inspector', { record: 'urn:example:post' }],
  }),
  c({
    id: 'view-state.close-panel',
    profile: 'view-state',
    note: 'Closing an instance by the id the host gave it, read from panelInstances.',
    address: '/space/garden',
    setup: [{ action: 'shellStore.openPanel', args: ['inspector', { record: 'urn:example:post' }] }],
    observe: PANELS,
    action: 'shellStore.closePanel',
    args: [{ $read: ['shellStore.panelInstances', 0, 'id'] }],
  }),
  c({
    id: 'view-state.toggle-lane',
    profile: 'view-state',
    note: 'Folding a lane away.',
    address: '/space/garden',
    observe: PANELS,
    action: 'shellStore.toggleLane',
    args: ['side'],
  }),
  c({
    id: 'view-state.toggle-lane-back',
    profile: 'view-state',
    note: 'Toggling a folded lane brings it back.',
    address: '/space/garden',
    setup: [{ action: 'shellStore.toggleLane', args: ['side'] }],
    observe: PANELS,
    action: 'shellStore.toggleLane',
    args: ['side'],
  }),
  c({
    id: 'view-state.set-lane-collapsed',
    profile: 'view-state',
    note: 'Folding a lane as said rather than flipped.',
    address: '/space/garden',
    observe: PANELS,
    action: 'shellStore.setLaneCollapsed',
    args: ['side', true],
  }),
  c({
    id: 'view-state.set-lane-collapsed-same',
    profile: 'view-state',
    note: 'Saying a folded lane is folded changes nothing.',
    address: '/space/garden',
    setup: [{ action: 'shellStore.setLaneCollapsed', args: ['side', true] }],
    observe: PANELS,
    action: 'shellStore.setLaneCollapsed',
    args: ['side', true],
  }),
  c({
    id: 'view-state.reset-template-layout',
    profile: 'view-state',
    note: 'Reset puts back every declared panel and unfolds every lane.',
    address: '/space/garden',
    setup: [
      { action: 'shellStore.closeTemplatePanel', args: ['inspector'] },
      { action: 'shellStore.setLaneCollapsed', args: ['side', true] },
    ],
    observe: PANELS,
    action: 'shellStore.resetTemplateLayout',
    args: [],
  }),
  c({
    id: 'view-state.scroll-to-id',
    profile: 'view-state',
    note: 'Scrolling is not state: nothing a profile reads changes.',
    address: '/space/garden',
    observe: PANELS,
    action: 'shellStore.scrollToId',
    args: ['urn:example:post'],
  }),
  c({
    id: 'view-state.configure',
    profile: 'view-state',
    note: 'A clock named for the first time, given a range.',
    address: '/space/garden',
    observe: CLOCKS,
    action: 'clockStore.configure',
    args: ['main', { from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z', speed: 2 }],
  }),
  c({
    id: 'view-state.play',
    profile: 'view-state',
    note: 'Playing from no moment starts at the range’s start. Time does not pass in a case.',
    address: '/space/garden',
    setup: [RANGE],
    observe: CLOCKS,
    action: 'clockStore.play',
    args: ['main'],
  }),
  c({
    id: 'view-state.play-without-a-range',
    profile: 'view-state',
    note: 'With no range to cross, play does nothing.',
    address: '/space/garden',
    setup: [{ action: 'clockStore.setLoop', args: ['main', false] }],
    observe: CLOCKS,
    action: 'clockStore.play',
    args: ['main'],
  }),
  c({
    id: 'view-state.pause',
    profile: 'view-state',
    note: 'Pausing stops the clock where it is.',
    address: '/space/garden',
    setup: [RANGE, { action: 'clockStore.play', args: ['main'] }],
    observe: CLOCKS,
    action: 'clockStore.pause',
    args: ['main'],
  }),
  c({
    id: 'view-state.toggle',
    profile: 'view-state',
    note: 'Toggling a stopped clock plays it.',
    address: '/space/garden',
    setup: [RANGE],
    observe: CLOCKS,
    action: 'clockStore.toggle',
    args: ['main'],
  }),
  c({
    id: 'view-state.seek',
    profile: 'view-state',
    note: 'Seeking shows a moment, kept inside the range.',
    address: '/space/garden',
    setup: [RANGE],
    observe: CLOCKS,
    action: 'clockStore.seek',
    args: ['main', 90000],
  }),
  c({
    id: 'view-state.seek-iso',
    profile: 'view-state',
    note: 'A moment may be given as an ISO date.',
    address: '/space/garden',
    setup: [{ action: 'clockStore.configure', args: ['main', { from: '2026-01-01', to: '2026-12-31' }] }],
    observe: CLOCKS,
    action: 'clockStore.seek',
    args: ['main', '2026-06-01T12:00:00.000Z'],
  }),
  c({
    id: 'view-state.seek-null',
    profile: 'view-state',
    note: 'null shows everything again.',
    address: '/space/garden',
    setup: [RANGE, { action: 'clockStore.seek', args: ['main', 30000] }],
    observe: CLOCKS,
    action: 'clockStore.seek',
    args: ['main', null],
  }),
  c({
    id: 'view-state.seek-progress',
    profile: 'view-state',
    note: 'A fraction of the way through the range.',
    address: '/space/garden',
    setup: [RANGE],
    observe: CLOCKS,
    action: 'clockStore.seekProgress',
    args: ['main', 0.25],
  }),
  c({
    id: 'view-state.set-speed',
    profile: 'view-state',
    note: 'Speed is a multiple of the clock’s own pace.',
    address: '/space/garden',
    setup: [RANGE],
    observe: CLOCKS,
    action: 'clockStore.setSpeed',
    args: ['main', 4],
  }),
  c({
    id: 'view-state.set-loop',
    profile: 'view-state',
    note: 'Looping is a setting the clock reports.',
    address: '/space/garden',
    setup: [RANGE],
    observe: CLOCKS,
    action: 'clockStore.setLoop',
    args: ['main', true],
  }),

  // ── presence ──────────────────────────────────────────────────────────────
  c({
    id: 'presence.read-roster',
    profile: 'presence',
    note: 'Who is here: everyone present in the space on screen, the viewing person included, and who is on this page.',
    address: '/space/garden/cards',
    observe: ROSTER,
  }),
  c({
    id: 'presence.read-personal-space',
    profile: 'presence',
    note: 'A personal space has nobody to be present to.',
    address: '/space/notebook',
    observe: ROSTER,
  }),
  c({
    id: 'presence.set-availability',
    profile: 'presence',
    note: 'The status said with this person’s presence.',
    address: '/space/garden/cards',
    observe: ROSTER,
    action: 'presenceStore.setAvailability',
    args: ['away'],
  }),
  c({
    id: 'presence.set-availability-invisible',
    profile: 'presence',
    note: 'Invisible stops saying anything.',
    address: '/space/garden/cards',
    observe: ROSTER,
    action: 'presenceStore.setAvailability',
    args: ['invisible'],
  }),
  c({
    id: 'presence.set-activity',
    profile: 'presence',
    note: 'Saying what this person is doing.',
    address: '/space/garden/cards',
    observe: ROSTER,
    action: 'presenceStore.setActivity',
    args: [{ type: 'editing', id: 'urn:example:post' }],
  }),
  c({
    id: 'presence.replace-activity',
    profile: 'presence',
    note: 'An activity of the same type and id replaces the one said before.',
    address: '/space/garden/cards',
    setup: [
      { action: 'presenceStore.setActivity', args: [{ type: 'editing', id: 'urn:example:post', field: 'title' }] },
    ],
    observe: ROSTER,
    action: 'presenceStore.setActivity',
    args: [{ type: 'editing', id: 'urn:example:post', field: 'body' }],
  }),
  c({
    id: 'presence.clear-activity',
    profile: 'presence',
    note: 'Withdrawing one activity by type and id.',
    address: '/space/garden/cards',
    setup: [
      { action: 'presenceStore.setActivity', args: [{ type: 'editing', id: 'urn:example:post' }] },
      { action: 'presenceStore.setActivity', args: [{ type: 'editing', id: 'urn:example:note' }] },
    ],
    observe: ROSTER,
    action: 'presenceStore.clearActivity',
    args: ['editing', 'urn:example:post'],
  }),
  c({
    id: 'presence.clear-activity-type',
    profile: 'presence',
    note: 'With no id, every activity of that type.',
    address: '/space/garden/cards',
    setup: [
      { action: 'presenceStore.setActivity', args: [{ type: 'editing', id: 'urn:example:post' }] },
      { action: 'presenceStore.setActivity', args: [{ type: 'editing', id: 'urn:example:note' }] },
    ],
    observe: ROSTER,
    action: 'presenceStore.clearActivity',
    args: ['editing'],
  }),
  c({
    id: 'presence.move-page',
    profile: 'presence',
    note: 'Moving to another page changes who shares it.',
    address: '/space/garden/cards',
    observe: ['presenceStore.onlineHere'],
    action: 'routeStore.navigate',
    args: ['~/about'],
  }),

  // ── identity ──────────────────────────────────────────────────────────────
  c({
    id: 'identity.read',
    profile: 'identity',
    note: 'Profiles as people published them, who is in the space, whom this person muted and what they read.',
    address: '/space/garden',
    observe: [
      'profileStore.ownProfile',
      'profileStore.ownProfileLoaded',
      'profileStore.profiles',
      'spaceStore.memberDids',
      'spaceStore.mutedDids',
      'spaceStore.readMarkers',
    ],
  }),
  c({
    id: 'identity.read-unnamed',
    profile: 'identity',
    note: 'Somebody who published no name is still named: the name is assembled and never empty.',
    world: 'unnamed',
    address: '/space/notebook',
    observe: ['profileStore.ownProfile', 'profileStore.ownProfileLoaded', 'spaceStore.memberDids'],
  }),
  c({
    id: 'identity.members-follow-the-space',
    profile: 'identity',
    note: 'Another space on screen, other members; the person’s own mutes and read markers go with them.',
    address: '/space/garden',
    observe: ['spaceStore.memberDids', 'spaceStore.mutedDids', 'spaceStore.readMarkers'],
    action: 'spaceStore.navigateToSpace',
    args: ['orchard'],
  }),

  // ── space-settings ────────────────────────────────────────────────────────
  c({
    id: 'space-settings.read',
    profile: 'space-settings',
    note: 'The space on screen, whether this person may change it, its defaults and this person’s settings.',
    address: '/space/garden',
    observe: [...SETTINGS, 'spaceStore.myModuleSettings'],
  }),
  c({
    id: 'space-settings.read-outside-a-space',
    profile: 'space-settings',
    note: 'Outside a space there is no space, and nothing to administer.',
    address: '/settings',
    observe: SETTINGS,
  }),
  c({
    id: 'space-settings.set-default-template',
    profile: 'space-settings',
    note: 'The template members see on entering.',
    address: '/space/garden',
    observe: SETTINGS,
    action: 'spaceStore.setSpaceDefaultTemplate',
    args: ['workshop'],
  }),
  c({
    id: 'space-settings.set-default-theme',
    profile: 'space-settings',
    note: 'The theme members see on entering.',
    address: '/space/garden',
    observe: SETTINGS,
    action: 'spaceStore.setSpaceDefaultTheme',
    args: ['paper'],
  }),
  c({
    id: 'space-settings.update-avatar',
    profile: 'space-settings',
    note: 'An image the person chose, stored and set as the avatar.',
    address: '/space/garden',
    observe: ['spaceStore.currentSpace'],
    action: 'spaceStore.updateSpaceImage',
    args: [
      'avatar',
      {
        $file: {
          name: 'avatar.png',
          type: 'image/png',
          base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        },
      },
    ],
  }),
  c({
    id: 'space-settings.update-cover-image',
    profile: 'space-settings',
    note: 'The same, as the cover image.',
    address: '/space/garden',
    observe: ['spaceStore.currentSpace'],
    action: 'spaceStore.updateSpaceImage',
    args: [
      'coverImage',
      {
        $file: {
          name: 'cover.png',
          type: 'image/png',
          base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        },
      },
    ],
  }),
  c({
    id: 'space-settings.hide-view',
    profile: 'space-settings',
    note: 'Hiding a section for this person only: the space keeps it, navigation drops it.',
    address: '/space/garden',
    observe: ['spaceStore.currentSpace', 'spaceStore.viewNav'],
    action: 'spaceStore.setViewVisible',
    args: ['cards', false],
  }),
  c({
    id: 'space-settings.show-view',
    profile: 'space-settings',
    note: 'Showing a hidden section again.',
    address: '/space/garden',
    setup: [{ action: 'spaceStore.setViewVisible', args: ['cards', false] }],
    observe: ['spaceStore.viewNav'],
    action: 'spaceStore.setViewVisible',
    args: ['cards', true],
  }),
  c({
    id: 'space-settings.hide-module',
    profile: 'space-settings',
    note: 'Hiding a module for this person only.',
    address: '/space/garden',
    observe: ['spaceStore.currentSpace', 'spaceStore.myModuleSettings'],
    action: 'spaceStore.setModuleVisible',
    args: ['reader', false],
  }),
  c({
    id: 'space-settings.set-my-setting',
    profile: 'space-settings',
    note: 'This person’s own value decides over the space’s.',
    address: '/space/garden',
    observe: ['spaceStore.myModuleSettings'],
    action: 'spaceStore.setMyModuleSetting',
    args: ['reader', 'density', 'tight'],
  }),
  c({
    id: 'space-settings.clear-my-setting',
    profile: 'space-settings',
    note: 'With no value, this person’s own is withdrawn and the next level decides again.',
    address: '/space/garden',
    setup: [{ action: 'spaceStore.setMyModuleSetting', args: ['reader', 'compact', true] }],
    observe: ['spaceStore.myModuleSettings'],
    action: 'spaceStore.setMyModuleSetting',
    args: ['reader', 'compact'],
  }),
];

/** The record types the worlds hold. */
export function profileWorldEntities(worlds: Record<string, ProfileWorld> = PROFILE_WORLDS): string[] {
  const names = new Set<string>();
  for (const world of Object.values(worlds)) {
    for (const record of [...(world.own ?? []), ...(world.spaces ?? []).flatMap((s) => s.records ?? [])])
      names.add(record.entity);
  }
  return [...names].sort();
}
