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
  profile: 'navigation' | 'view-state' | 'layout' | 'presence' | 'identity' | 'space-settings' | 'appearance';
  /** What the case shows, in a sentence. */
  note: string;
}

const ME = 'did:example:me';
const ADA = 'did:example:ada';
const BO = 'did:example:bo';

/** A theme the garden holds and opens with, and one the viewing person keeps for themselves. */
const MOSS = 'urn:example:theme-moss';
const DUSK = 'urn:example:theme-dusk';

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
          defaultThemeId: MOSS,
        }),
        { entity: 'Theme', id: MOSS, fields: { name: 'Moss', slug: 'moss' } },
        {
          entity: 'Template',
          id: 'urn:example:template-plots',
          fields: {
            name: 'Plots',
            icon: 'plant',
            // The template itself, as the file a Template record holds: the template's JSON.
            schema: JSON.stringify({
              schemaVersion: 1,
              id: 'plots',
              type: 'Column',
              meta: { name: 'Plots', description: 'Beds and what is in them', icon: 'plant' },
              children: [],
            }),
          },
        },
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
    { entity: 'Theme', id: DUSK, fields: { name: 'Dusk', slug: 'dusk' } },
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

const ADDRESS = ['navigation.currentPath', 'navigation.segments', 'navigation.templateSegments', 'navigation.params'];
const SPACE = ['navigation.spacePath', 'navigation.viewNav'];
const PANELS = ['viewState.panelInstances'];
const LAYOUT = ['layout.layoutDirty', 'layout.collapsedLanes'];
const ROSTER = ['presence.available', 'presence.peers', 'presence.online', 'presence.onlineHere'];
const SETTINGS = [
  'spaceSettings.currentSpace',
  'spaceSettings.canAdministerCurrentSpace',
  'spaceSettings.spaceDefaultTemplateId',
  'spaceSettings.spaceDefaultThemeId',
];
const CLOCKS = ['viewState.clocks'];
const TEMPLATES = ['appearance.switcherGroups', 'appearance.currentSwitcherId', 'appearance.templateOverrideOptions'];
const THEMES = [
  'appearance.builtInThemes',
  'appearance.installedThemes',
  'appearance.spaceThemes',
  'appearance.themeOverrideOptions',
  'appearance.currentThemeId',
  'appearance.spaceThemePinned',
];
const RANGE = { action: 'viewState.configure', args: ['main', { from: 0, to: 60000 }] };

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
    observe: [...ADDRESS, ...SPACE, 'navigation.mySpaces'],
  }),
  c({
    id: 'navigation.read-outside-a-space',
    profile: 'navigation',
    note: 'Outside a space the template segments are the whole path, and there is no space path.',
    address: '/settings',
    observe: [...ADDRESS, 'navigation.spacePath'],
  }),
  c({
    id: 'navigation.navigate-from-root',
    profile: 'navigation',
    note: '"~/x" goes from the template’s root, the space it is mounted under.',
    address: '/space/garden/about',
    observe: ADDRESS,
    action: 'navigation.navigate',
    args: ['~/cards'],
  }),
  c({
    id: 'navigation.navigate-with-query',
    profile: 'navigation',
    note: 'A record id goes in the query, written so it reads back exactly.',
    address: '/space/garden/about',
    observe: ADDRESS,
    action: 'navigation.navigate',
    args: ['~/record/CollectionBlock', { query: { id: 'urn:example:post' } }],
  }),
  c({
    id: 'navigation.navigate-query-only',
    profile: 'navigation',
    note: '"?q" is the page on screen with that query.',
    address: '/space/garden/cards',
    observe: ADDRESS,
    action: 'navigation.navigate',
    args: ['?sort=old'],
  }),
  c({
    id: 'navigation.navigate-up',
    profile: 'navigation',
    note: '".." from the root route stays at the root: a template cannot climb out of its space that way.',
    address: '/space/garden/cards',
    observe: ADDRESS,
    action: 'navigation.navigate',
    args: ['..'],
  }),
  c({
    id: 'navigation.navigate-absolute',
    profile: 'navigation',
    note: 'An absolute path leaves the template.',
    address: '/space/garden/cards',
    observe: [...ADDRESS, ...SPACE],
    action: 'navigation.navigate',
    args: ['/settings'],
  }),
  c({
    id: 'navigation.navigate-to-where-it-is',
    profile: 'navigation',
    note: 'Going to the page on screen changes nothing and says nothing.',
    address: '/space/garden/cards',
    observe: ADDRESS,
    action: 'navigation.navigate',
    args: ['/space/garden/cards'],
  }),
  c({
    id: 'navigation.set-param',
    profile: 'navigation',
    note: 'One query parameter written; the path is unchanged.',
    address: '/space/garden/cards?sort=new',
    observe: ADDRESS,
    action: 'navigation.setParam',
    args: ['type', 'posts'],
  }),
  c({
    id: 'navigation.set-param-null',
    profile: 'navigation',
    note: 'null removes the parameter.',
    address: '/space/garden/cards?sort=new&type=posts',
    observe: ADDRESS,
    action: 'navigation.setParam',
    args: ['sort', null],
  }),
  c({
    id: 'navigation.set-param-same',
    profile: 'navigation',
    note: 'Writing the value a parameter already holds changes nothing and says nothing.',
    address: '/space/garden/cards?sort=new',
    observe: ADDRESS,
    action: 'navigation.setParam',
    args: ['sort', 'new'],
  }),
  c({
    id: 'navigation.set-param-push',
    profile: 'navigation',
    note: 'With push, the write is a history entry of its own: Back returns to the query before it.',
    address: '/space/garden/cards?type=posts',
    setup: [{ action: 'navigation.setParam', args: ['type', 'events', { push: true }] }],
    observe: ADDRESS,
    action: 'navigation.back',
    args: [],
  }),
  c({
    id: 'navigation.back',
    profile: 'navigation',
    note: 'Back goes to the entry before, query and all.',
    address: '/space/garden/cards',
    history: ['/space/garden/about?tab=people'],
    observe: [...ADDRESS, ...SPACE],
    action: 'navigation.back',
    args: [],
  }),
  c({
    id: 'navigation.navigate-to-space',
    profile: 'navigation',
    note: 'Going to another space carries the section across when that space has it, and its sections follow.',
    address: '/space/garden/cards',
    observe: [...ADDRESS, ...SPACE],
    action: 'navigation.navigateToSpace',
    args: ['orchard'],
  }),
  c({
    id: 'navigation.navigate-to-space-without-the-section',
    profile: 'navigation',
    note: 'A section the destination does not have is not carried: the space itself is opened.',
    address: '/space/garden/boards',
    observe: [...ADDRESS, ...SPACE],
    action: 'navigation.navigateToSpace',
    args: ['orchard'],
  }),
  c({
    id: 'navigation.navigate-to-space-section',
    profile: 'navigation',
    note: 'A named section is always taken.',
    address: '/space/garden/cards',
    observe: [...ADDRESS, ...SPACE],
    action: 'navigation.navigateToSpace',
    args: ['orchard', 'about'],
  }),
  c({
    id: 'navigation.open-record-ref',
    profile: 'navigation',
    note: 'A record reference opens its space, and the record’s own page in it.',
    address: '/space/garden/cards',
    observe: [...ADDRESS, ...SPACE],
    action: 'navigation.openRecordRef',
    args: ['we:n:orchard/CollectionBlock/urn:example:post'],
  }),
  c({
    id: 'navigation.open-dataset-ref',
    profile: 'navigation',
    note: 'A reference naming only a space opens the space.',
    address: '/space/garden/cards',
    observe: [...ADDRESS, ...SPACE],
    action: 'navigation.openRecordRef',
    args: ['we:n:orchard'],
  }),
  c({
    id: 'navigation.open-person-ref',
    profile: 'navigation',
    note: 'A reference naming a person goes nowhere.',
    address: '/space/garden/cards',
    observe: ADDRESS,
    action: 'navigation.openRecordRef',
    args: [`we:agent/${ADA}`],
  }),

  // ── view-state ────────────────────────────────────────────────────────────
  c({
    id: 'view-state.read-declared',
    profile: 'view-state',
    note: 'A template’s declared panels, untouched: no instances opened beyond them.',
    address: '/space/garden',
    observe: PANELS,
  }),
  c({
    id: 'view-state.close-template-panel',
    profile: 'view-state',
    note: 'Closing a declared panel opens or closes no instance; the arrangement it changes is layout’s.',
    address: '/space/garden',
    observe: PANELS,
    action: 'viewState.closeTemplatePanel',
    args: ['inspector'],
  }),
  c({
    id: 'view-state.open-template-panel',
    profile: 'view-state',
    note: 'Putting a closed declared panel back.',
    address: '/space/garden',
    setup: [{ action: 'viewState.closeTemplatePanel', args: ['inspector'] }],
    observe: PANELS,
    action: 'viewState.openTemplatePanel',
    args: ['inspector'],
  }),
  c({
    id: 'view-state.open-panel',
    profile: 'view-state',
    note: 'Another instance of a declared panel, with what it was opened with.',
    address: '/space/garden',
    observe: PANELS,
    action: 'viewState.openPanel',
    args: ['inspector', { record: 'urn:example:post' }, { title: 'The post' }],
  }),
  c({
    id: 'view-state.open-panel-again',
    profile: 'view-state',
    note: 'The same inputs again bring the open instance forward rather than opening a second.',
    address: '/space/garden',
    setup: [{ action: 'viewState.openPanel', args: ['inspector', { record: 'urn:example:post' }] }],
    observe: PANELS,
    action: 'viewState.openPanel',
    args: ['inspector', { record: 'urn:example:post' }],
  }),
  c({
    id: 'view-state.close-panel',
    profile: 'view-state',
    note: 'Closing an instance by the id the host gave it, read from panelInstances.',
    address: '/space/garden',
    setup: [{ action: 'viewState.openPanel', args: ['inspector', { record: 'urn:example:post' }] }],
    observe: PANELS,
    action: 'viewState.closePanel',
    args: [{ $read: ['viewState.panelInstances', 0, 'id'] }],
  }),
  c({
    id: 'view-state.scroll-to-id',
    profile: 'view-state',
    note: 'Scrolling is not state: nothing a profile reads changes.',
    address: '/space/garden',
    observe: PANELS,
    action: 'viewState.scrollToId',
    args: ['urn:example:post'],
  }),

  // ── layout ────────────────────────────────────────────────────────────────
  c({
    id: 'layout.read-declared',
    profile: 'layout',
    note: 'A template’s declared panels as it arranged them: nothing moved, no lane folded.',
    address: '/space/garden',
    observe: LAYOUT,
  }),
  c({
    id: 'layout.close-template-panel',
    profile: 'layout',
    note: 'Closing a declared panel is a change to the arrangement the template declared.',
    address: '/space/garden',
    observe: LAYOUT,
    action: 'viewState.closeTemplatePanel',
    args: ['inspector'],
  }),
  c({
    id: 'layout.open-template-panel',
    profile: 'layout',
    note: 'Putting the only closed panel back leaves the arrangement as the template declared it.',
    address: '/space/garden',
    setup: [{ action: 'viewState.closeTemplatePanel', args: ['inspector'] }],
    observe: LAYOUT,
    action: 'viewState.openTemplatePanel',
    args: ['inspector'],
  }),
  c({
    id: 'layout.toggle-lane',
    profile: 'layout',
    note: 'Folding a lane away.',
    address: '/space/garden',
    observe: LAYOUT,
    action: 'layout.toggleLane',
    args: ['side'],
  }),
  c({
    id: 'layout.toggle-lane-back',
    profile: 'layout',
    note: 'Toggling a folded lane brings it back.',
    address: '/space/garden',
    setup: [{ action: 'layout.toggleLane', args: ['side'] }],
    observe: LAYOUT,
    action: 'layout.toggleLane',
    args: ['side'],
  }),
  c({
    id: 'layout.set-lane-collapsed',
    profile: 'layout',
    note: 'Folding a lane as said rather than flipped.',
    address: '/space/garden',
    observe: LAYOUT,
    action: 'layout.setLaneCollapsed',
    args: ['side', true],
  }),
  c({
    id: 'layout.set-lane-collapsed-same',
    profile: 'layout',
    note: 'Saying a folded lane is folded changes nothing.',
    address: '/space/garden',
    setup: [{ action: 'layout.setLaneCollapsed', args: ['side', true] }],
    observe: LAYOUT,
    action: 'layout.setLaneCollapsed',
    args: ['side', true],
  }),
  c({
    id: 'layout.unfold-lane',
    profile: 'layout',
    note: 'Unfolding a folded lane, as said.',
    address: '/space/garden',
    setup: [{ action: 'layout.setLaneCollapsed', args: ['side', true] }],
    observe: LAYOUT,
    action: 'layout.setLaneCollapsed',
    args: ['side', false],
  }),
  c({
    id: 'layout.reset-template-layout',
    profile: 'layout',
    note: 'Reset puts back every declared panel and unfolds every lane.',
    address: '/space/garden',
    setup: [
      { action: 'viewState.closeTemplatePanel', args: ['inspector'] },
      { action: 'layout.setLaneCollapsed', args: ['side', true] },
    ],
    observe: [...LAYOUT, ...PANELS],
    action: 'layout.resetTemplateLayout',
    args: [],
  }),
  c({
    id: 'layout.reset-untouched',
    profile: 'layout',
    note: 'Resetting what nobody moved changes nothing.',
    address: '/space/garden',
    observe: LAYOUT,
    action: 'layout.resetTemplateLayout',
    args: [],
  }),

  // ── view-state: clocks ────────────────────────────────────────────────────
  c({
    id: 'view-state.configure',
    profile: 'view-state',
    note: 'A clock named for the first time, given a range.',
    address: '/space/garden',
    observe: CLOCKS,
    action: 'viewState.configure',
    args: ['main', { from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z', speed: 2 }],
  }),
  c({
    id: 'view-state.play',
    profile: 'view-state',
    note: 'Playing from no moment starts at the range’s start. Time does not pass in a case.',
    address: '/space/garden',
    setup: [RANGE],
    observe: CLOCKS,
    action: 'viewState.play',
    args: ['main'],
  }),
  c({
    id: 'view-state.play-without-a-range',
    profile: 'view-state',
    note: 'With no range to cross, play does nothing.',
    address: '/space/garden',
    setup: [{ action: 'viewState.setLoop', args: ['main', false] }],
    observe: CLOCKS,
    action: 'viewState.play',
    args: ['main'],
  }),
  c({
    id: 'view-state.pause',
    profile: 'view-state',
    note: 'Pausing stops the clock where it is.',
    address: '/space/garden',
    setup: [RANGE, { action: 'viewState.play', args: ['main'] }],
    observe: CLOCKS,
    action: 'viewState.pause',
    args: ['main'],
  }),
  c({
    id: 'view-state.toggle',
    profile: 'view-state',
    note: 'Toggling a stopped clock plays it.',
    address: '/space/garden',
    setup: [RANGE],
    observe: CLOCKS,
    action: 'viewState.toggle',
    args: ['main'],
  }),
  c({
    id: 'view-state.seek',
    profile: 'view-state',
    note: 'Seeking shows a moment, kept inside the range.',
    address: '/space/garden',
    setup: [RANGE],
    observe: CLOCKS,
    action: 'viewState.seek',
    args: ['main', 90000],
  }),
  c({
    id: 'view-state.seek-iso',
    profile: 'view-state',
    note: 'A moment may be given as an ISO date.',
    address: '/space/garden',
    setup: [{ action: 'viewState.configure', args: ['main', { from: '2026-01-01', to: '2026-12-31' }] }],
    observe: CLOCKS,
    action: 'viewState.seek',
    args: ['main', '2026-06-01T12:00:00.000Z'],
  }),
  c({
    id: 'view-state.seek-null',
    profile: 'view-state',
    note: 'null shows everything again.',
    address: '/space/garden',
    setup: [RANGE, { action: 'viewState.seek', args: ['main', 30000] }],
    observe: CLOCKS,
    action: 'viewState.seek',
    args: ['main', null],
  }),
  c({
    id: 'view-state.seek-progress',
    profile: 'view-state',
    note: 'A fraction of the way through the range.',
    address: '/space/garden',
    setup: [RANGE],
    observe: CLOCKS,
    action: 'viewState.seekProgress',
    args: ['main', 0.25],
  }),
  c({
    id: 'view-state.set-speed',
    profile: 'view-state',
    note: 'Speed is a multiple of the clock’s own pace.',
    address: '/space/garden',
    setup: [RANGE],
    observe: CLOCKS,
    action: 'viewState.setSpeed',
    args: ['main', 4],
  }),
  c({
    id: 'view-state.set-loop',
    profile: 'view-state',
    note: 'Looping is a setting the clock reports.',
    address: '/space/garden',
    setup: [RANGE],
    observe: CLOCKS,
    action: 'viewState.setLoop',
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
    action: 'presence.setAvailability',
    args: ['away'],
  }),
  c({
    id: 'presence.set-availability-invisible',
    profile: 'presence',
    note: 'Invisible stops saying anything.',
    address: '/space/garden/cards',
    observe: ROSTER,
    action: 'presence.setAvailability',
    args: ['invisible'],
  }),
  c({
    id: 'presence.set-activity',
    profile: 'presence',
    note: 'Saying what this person is doing.',
    address: '/space/garden/cards',
    observe: ROSTER,
    action: 'presence.setActivity',
    args: [{ type: 'editing', id: 'urn:example:post' }],
  }),
  c({
    id: 'presence.replace-activity',
    profile: 'presence',
    note: 'An activity of the same type and id replaces the one said before.',
    address: '/space/garden/cards',
    setup: [{ action: 'presence.setActivity', args: [{ type: 'editing', id: 'urn:example:post', field: 'title' }] }],
    observe: ROSTER,
    action: 'presence.setActivity',
    args: [{ type: 'editing', id: 'urn:example:post', field: 'body' }],
  }),
  c({
    id: 'presence.clear-activity',
    profile: 'presence',
    note: 'Withdrawing one activity by type and id.',
    address: '/space/garden/cards',
    setup: [
      { action: 'presence.setActivity', args: [{ type: 'editing', id: 'urn:example:post' }] },
      { action: 'presence.setActivity', args: [{ type: 'editing', id: 'urn:example:note' }] },
    ],
    observe: ROSTER,
    action: 'presence.clearActivity',
    args: ['editing', 'urn:example:post'],
  }),
  c({
    id: 'presence.clear-activity-type',
    profile: 'presence',
    note: 'With no id, every activity of that type.',
    address: '/space/garden/cards',
    setup: [
      { action: 'presence.setActivity', args: [{ type: 'editing', id: 'urn:example:post' }] },
      { action: 'presence.setActivity', args: [{ type: 'editing', id: 'urn:example:note' }] },
    ],
    observe: ROSTER,
    action: 'presence.clearActivity',
    args: ['editing'],
  }),
  c({
    id: 'presence.move-page',
    profile: 'presence',
    note: 'Moving to another page changes who shares it.',
    address: '/space/garden/cards',
    observe: ['presence.onlineHere'],
    action: 'navigation.navigate',
    args: ['~/about'],
  }),

  // ── identity ──────────────────────────────────────────────────────────────
  c({
    id: 'identity.read',
    profile: 'identity',
    note: 'Profiles as people published them, who is in the space, whom this person muted and what they read.',
    address: '/space/garden',
    observe: [
      'identity.ownProfile',
      'identity.ownProfileLoaded',
      'identity.profiles',
      'identity.memberDids',
      'identity.mutedDids',
      'identity.readMarkers',
    ],
  }),
  c({
    id: 'identity.read-unnamed',
    profile: 'identity',
    note: 'Somebody who published no name is still named: the name is assembled and never empty.',
    world: 'unnamed',
    address: '/space/notebook',
    observe: ['identity.ownProfile', 'identity.ownProfileLoaded', 'identity.memberDids'],
  }),
  c({
    id: 'identity.members-follow-the-space',
    profile: 'identity',
    note: 'Another space on screen, other members; the person’s own mutes and read markers go with them.',
    address: '/space/garden',
    observe: ['identity.memberDids', 'identity.mutedDids', 'identity.readMarkers'],
    action: 'navigation.navigateToSpace',
    args: ['orchard'],
  }),

  // ── space-settings ────────────────────────────────────────────────────────
  c({
    id: 'space-settings.read',
    profile: 'space-settings',
    note: 'The space on screen, whether this person may change it, its defaults and this person’s settings.',
    address: '/space/garden',
    observe: [...SETTINGS, 'spaceSettings.myModuleSettings'],
  }),
  c({
    id: 'space-settings.read-outside-a-space',
    profile: 'space-settings',
    note: 'Outside a space there is no space, and nothing to administer.',
    address: '/settings',
    observe: SETTINGS,
  }),
  c({
    id: 'space-settings.prepare-avatar',
    profile: 'space-settings',
    note: 'Making a chosen picture into what the record stores changes nothing: writing it is the space’s operation.',
    address: '/space/garden',
    observe: ['spaceSettings.currentSpace'],
    action: 'spaceSettings.prepareSpaceImage',
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
    id: 'space-settings.hide-view',
    profile: 'space-settings',
    note: 'Hiding a section for this person only: the space keeps it, navigation drops it.',
    address: '/space/garden',
    observe: ['spaceSettings.currentSpace', 'navigation.viewNav'],
    action: 'spaceSettings.setViewVisible',
    args: ['cards', false],
  }),
  c({
    id: 'space-settings.show-view',
    profile: 'space-settings',
    note: 'Showing a hidden section again.',
    address: '/space/garden',
    setup: [{ action: 'spaceSettings.setViewVisible', args: ['cards', false] }],
    observe: ['navigation.viewNav'],
    action: 'spaceSettings.setViewVisible',
    args: ['cards', true],
  }),
  c({
    id: 'space-settings.hide-module',
    profile: 'space-settings',
    note: 'Hiding a module for this person only.',
    address: '/space/garden',
    observe: ['spaceSettings.currentSpace', 'spaceSettings.myModuleSettings'],
    action: 'spaceSettings.setModuleVisible',
    args: ['reader', false],
  }),
  c({
    id: 'space-settings.set-my-setting',
    profile: 'space-settings',
    note: 'This person’s own value decides over the space’s.',
    address: '/space/garden',
    observe: ['spaceSettings.myModuleSettings'],
    action: 'spaceSettings.setMyModuleSetting',
    args: ['reader', 'density', 'tight'],
  }),
  c({
    id: 'space-settings.clear-my-setting',
    profile: 'space-settings',
    note: 'With no value, this person’s own is withdrawn and the next level decides again.',
    address: '/space/garden',
    setup: [{ action: 'spaceSettings.setMyModuleSetting', args: ['reader', 'compact', true] }],
    observe: ['spaceSettings.myModuleSettings'],
    action: 'spaceSettings.setMyModuleSetting',
    args: ['reader', 'compact'],
  }),

  // ── appearance ────────────────────────────────────────────────────────────
  c({
    id: 'appearance.read',
    profile: 'appearance',
    note: 'In a space: its own template and theme on offer beside this person’s, under a template the host brings that brings a theme of its own.',
    address: '/space/garden',
    observe: [...TEMPLATES, ...THEMES],
  }),
  c({
    id: 'appearance.read-outside-a-space',
    profile: 'appearance',
    note: 'Outside a space nothing of a space is on offer, and what is on screen is the host’s for this person.',
    address: '/settings',
    observe: [...TEMPLATES, ...THEMES],
  }),
  c({
    id: 'appearance.switch-template',
    profile: 'appearance',
    note: 'Switching to the space’s own template, by its switcher row.',
    address: '/space/garden',
    observe: ['appearance.currentSwitcherId'],
    action: 'appearance.switchTemplate',
    args: [{ $read: ['appearance.switcherGroups', 0, 'items', 0, 'id'] }],
  }),
  c({
    id: 'appearance.set-template-override',
    profile: 'appearance',
    note: 'Choosing to see the space’s own template here, over a default that names none, as this person alone.',
    address: '/space/garden',
    observe: ['appearance.currentSwitcherId', 'appearance.templateOverrideOptions'],
    action: 'appearance.setSpaceTemplateOverride',
    args: ['plots'],
  }),
  c({
    id: 'appearance.set-template-override-own-default',
    profile: 'appearance',
    note: 'The second option follows this person’s own default template here — the host’s, in this world — under which the space’s own theme shows.',
    address: '/space/garden',
    observe: ['appearance.currentSwitcherId', 'appearance.currentThemeId'],
    action: 'appearance.setSpaceTemplateOverride',
    args: [{ $read: ['appearance.templateOverrideOptions', 1, 'value'] }],
  }),
  c({
    id: 'appearance.apply-theme',
    profile: 'appearance',
    note: 'A theme of this person’s own, chosen for the space on screen: shown, and a choice there is to undo.',
    address: '/space/garden',
    observe: ['appearance.currentThemeId', 'appearance.spaceThemePinned'],
    action: 'appearance.applyTheme',
    args: [DUSK],
  }),
  c({
    id: 'appearance.apply-the-space-theme-over-the-template',
    profile: 'appearance',
    note: 'Under a template that brings its own theme, choosing the space’s is a choice of its own, and one there is to undo.',
    address: '/space/garden',
    observe: ['appearance.currentThemeId', 'appearance.spaceThemePinned'],
    action: 'appearance.applyTheme',
    args: [MOSS],
  }),
  c({
    id: 'appearance.clear-space-theme-pin',
    profile: 'appearance',
    note: 'Withdrawing the choice shows what showed before it.',
    address: '/space/garden',
    setup: [{ action: 'appearance.applyTheme', args: [DUSK] }],
    observe: ['appearance.currentThemeId', 'appearance.spaceThemePinned'],
    action: 'appearance.clearSpaceThemePin',
    args: [],
  }),
  c({
    id: 'appearance.set-theme-override',
    profile: 'appearance',
    note: 'Choosing a theme for the space by its override option, as a picker does.',
    address: '/space/garden',
    observe: ['appearance.currentThemeId', 'appearance.spaceThemePinned'],
    action: 'appearance.setSpaceThemeOverride',
    args: [DUSK],
  }),
  c({
    id: 'appearance.set-theme-override-own-default',
    profile: 'appearance',
    note: 'The second option follows this person’s own default theme here, whatever the space’s is: the host’s, in this world.',
    address: '/space/garden',
    observe: ['appearance.currentThemeId', 'appearance.spaceThemePinned'],
    action: 'appearance.setSpaceThemeOverride',
    args: [{ $read: ['appearance.themeOverrideOptions', 1, 'value'] }],
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
