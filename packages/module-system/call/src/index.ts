/**
 * The Call feature module — mesh WebRTC audio, video and screen share.
 *
 * The third module, and the one that tests what the first two could not: that a module can reach the
 * **ephemeral port**. Notes proved a module can own durable entities; the globe proved a module can
 * carry a heavyweight framework component. Neither sent a byte to another agent.
 *
 * ## Still fragments-only
 *
 * The surprise of this build. A call seemed certain to need a framework component — live video means
 * assigning `srcObject` to a `<video>`, which is imperative and cannot be expressed as data.
 *
 * It does not, because that imperative step belongs one layer down: `we-video` gained a `stream`
 * property, and a Lit primitive is precisely where WE puts imperative DOM work so that every
 * framework gets it once. So the most demanding module in the codebase declares no `frameworks` and
 * imports no framework — which means it is the strongest evidence so far that the fragments-first
 * contract is real rather than aspirational.
 *
 * ## What it does not do
 *
 * - **No TURN server.** Peers behind symmetric NAT will not connect. TURN is infrastructure someone
 *   has to run, so it is a deployment decision rather than a module one.
 * - **No SFU.** Mesh only, so roughly four to six participants — see `mesh.ts`.
 * - **No camera *and* screen at once.** Sharing replaces the camera track — see `media.ts`.
 */
import { defineModule, type ModuleStoreDeps } from '@we/module-shared';
import { type SchemaNode } from '@we/schema-shared';

import { createCallStore } from './store';

export { createCallMesh, type CallMesh, type SignallingChannel } from './mesh';
export { createMediaController, type MediaController, type MediaState } from './media';
export { anchoredCallId, CALL_PROTOCOL_VERSION, parseCallMessage, spaceCallId } from './protocol';
export { createCallStore, type CallTile } from './store';

/**
 * Where the call's chrome sits.
 *
 * Both at the top, controls above video. That is not where this started: the bar was docked at the
 * bottom and only *appeared* at the top because `bottom: '400'` is not a CSS length, so the offset was
 * dropped and `position: fixed` fell back to the static position. The accident read better than the
 * design, so it is now the design — a call you are in should be visible where your eyes already are,
 * not competing with whatever the space puts along the bottom.
 *
 * Named rather than inlined because the stage's offset is *derived* from the bar's: the two must stay
 * stacked, and a bare `128px` in one file and `72px` in another is a relationship nothing records.
 */
const CALL_BAR_TOP = '10px';
/**
 * Bar top + bar height + a gap, so the stage sits tucked directly under the controls.
 *
 * The bar is 50px tall: a 32px `sm` button, plus `py: '200'` (8px) top and bottom, plus its 1px
 * borders. 10 + 50 + 12 = 72. Written out because the two constants have to move together, and the
 * next person to nudge the bar needs to know what the second number is made of.
 */
const STAGE_TOP = '72px';

/**
 * A participant's volatile flag, looked up rather than read off the tile.
 *
 * The tile object carries only identity and stream, because `$each` renders through a
 * reference-keyed `<For>` and any change to the item remounts the row — taking the `<video>` with it.
 * Muting your microphone blanked your own video for exactly that reason.
 *
 * `$find` over a `$store` resolves inside the renderer's prop memo, so reading the signal registers a
 * dependency and the prop updates on its own. The row never remounts; only the badge changes.
 */
const stateOf = (field: string) => ({
  $find: { items: { $store: 'modules.call.tileStates' }, where: { id: '$tile.id' }, select: field },
});

/** One participant's video, or their avatar when there is nothing to show. */
const tile: SchemaNode = {
  type: 'Column',
  props: {
    position: 'relative',
    // Low-numbered, so it stays a recessed surface under both themes — see the note on `stage`.
    bg: 'neutral-100',
    r: '400',
    overflow: 'hidden',
    // Grow to share the row, and stretch to the stage's full height rather than being capped at a
    // fixed one — a hardcoded height was what made the video small regardless of available space.
    flex: '1 1 280px',
    minWidth: '220px',
    minHeight: '160px',
    alignSelf: 'stretch',
    ax: 'center',
    ay: 'center',
  },
  children: [
    {
      type: '$if',
      props: {
        // A tile with no stream yet is normal for the first second or two of a join, and a peer with
        // their camera off never gets one at all. Both show the avatar rather than a black rectangle.
        condition: { $and: ['$tile.stream', { $or: [stateOf('videoEnabled'), stateOf('isScreen')] }] },
        then: {
          type: 'we-video',
          props: {
            stream: '$tile.stream',
            autoplay: true,
            playsinline: true,
            // Never hear yourself. The self tile plays the same microphone the mesh is sending, and
            // unmuted it is an immediate feedback loop.
            muted: '$tile.isSelf',
            width: '100%',
            height: '100%',
            // A desktop cropped to fill a camera-shaped tile is unreadable — `contain` letterboxes it
            // instead. Driven by the roster, because only the sender knows which it is sending.
            fit: { $if: { condition: stateOf('isScreen'), then: 'contain', else: 'cover' } },
          },
        },
        else: {
          // `hash` gives every participant a distinct generated avatar from their DID. Profiles are
          // not reachable from here — presence carries `agentId` only, and joining it to a profile is
          // the host's job — so this is what there is until an identities port is lent to modules.
          type: 'we-avatar',
          props: { image: '$tile.avatar', hash: '$tile.did', initials: '$tile.name', size: 'lg' },
        },
      },
    },
    {
      type: 'Row',
      props: { position: 'absolute', bottom: '200', left: '200', gap: '100', ay: 'center' },
      children: [
        {
          type: '$if',
          props: {
            condition: { $not: stateOf('audioEnabled') },
            then: {
              type: 'we-badge',
              props: { variant: 'neutral', size: 'xs' },
              children: [{ type: 'we-icon', props: { name: 'microphone-slash' } }],
            },
          },
        },
        {
          type: '$if',
          props: {
            condition: stateOf('isScreen'),
            then: {
              type: 'we-badge',
              props: { variant: 'primary', size: 'xs' },
              children: [{ type: 'we-icon', props: { name: 'monitor' } }],
            },
          },
        },
        {
          // Reconnecting is worth saying out loud — silence looks identical to a frozen call.
          type: '$if',
          props: {
            condition: { $in: [stateOf('connection'), ['connecting', 'disconnected', 'failed']] },
            then: {
              type: 'we-badge',
              props: { variant: 'warning', size: 'xs' },
              children: [stateOf('connection')],
            },
          },
        },
      ],
    },
  ],
};

/**
 * The expanded stage — every participant, directly under the controls.
 *
 * A `Row` that wraps, not a `Grid`. `Grid`'s `minChildWidth` compiles to
 * `repeat(auto-fill, minmax(…, 1fr))`, and `auto-fill` keeps empty tracks — so a one-person call drew
 * a small tile on the left and a wide band of nothing to its right. Wrapping flex items grow to fill
 * the row instead, at every participant count, and `ay: stretch` lets them take the stage's full
 * height rather than a hardcoded one.
 *
 * Colours are theme-relative, and that matters more than it looks. Dark themes invert the neutral
 * scale (`multiplier: -1`), so `neutral-1000` is black in the light theme and near-white in the dark
 * one — which is exactly how this shipped as a white stage. There is no "always dark" neutral; a
 * surface that must follow the theme has to use the same low-numbered tokens as the rest of the app.
 */
const stage: SchemaNode = {
  type: '$if',
  props: {
    condition: { $and: [{ $store: 'modules.call.active' }, { $store: 'modules.call.expanded' }] },
    then: {
      type: 'Row',
      props: {
        position: 'fixed',
        // Directly under the control bar — see CALL_BAR_TOP.
        top: STAGE_TOP,
        left: '16px',
        // Clears the module rail on the right edge, which is 48px wide plus a margin.
        right: '72px',
        height: '38vh',
        wrap: true,
        gap: '300',
        p: '300',
        ax: 'center',
        // Stretch, so a tile fills the stage's height instead of sitting at a fixed size in the middle.
        ay: 'stretch',
        bg: 'neutral-0',
        border: '1px solid neutral-200',
        r: '500',
        shadow: 'xl',
        overflow: 'auto',
        zIndex: 'sticky',
      },
      children: [{ type: '$each', props: { items: { $store: 'modules.call.tiles' }, as: 'tile' }, children: [tile] }],
    },
  },
};

/** A toggle button whose icon and tone follow the state it toggles. */
function mediaToggle(opts: { on: string; off: string; enabled: string; action: string; danger?: boolean }): SchemaNode {
  return {
    type: 'we-button',
    props: {
      size: 'sm',
      variant: { $if: { condition: { $store: opts.enabled }, then: 'secondary', else: 'ghost' } },
      onClick: { $action: opts.action },
    },
    children: [
      {
        type: 'we-icon',
        props: { name: { $if: { condition: { $store: opts.enabled }, then: opts.on, else: opts.off } } },
      },
    ],
  };
}

/** The bar, in its two states: a call is running and you are not in it, or you are. */
const bar: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'modules.call.active' },

    // ── Not in a call ────────────────────────────────────────────────────────
    // Shown only when somebody else is in one, offering to join. *Starting* a call is the module
    // rail's job now — it was a floating pill here, which is what made the launcher inconsistency
    // visible in the first place.
    else: {
      type: '$if',
      props: {
        condition: { $count: { items: { $store: 'modules.call.ongoing' } } },
        then: {
          type: 'Row',
          props: {
            position: 'fixed',
            top: CALL_BAR_TOP,
            left: '50%',
            transform: 'translateX(-50%)',
            bg: 'neutral-0',
            border: '1px solid neutral-200',
            r: 'pill',
            shadow: 'lg',
            py: '200',
            px: '300',
            gap: '300',
            ay: 'center',
            zIndex: 'sticky',
          },
          children: [
            {
              type: 'AvatarStack',
              props: { avatars: { $store: 'modules.call.ongoing' }, size: 'xs', max: 4 },
            },
            {
              type: 'we-text',
              props: { variant: 'label' },
              children: [
                { type: 'we-number', props: { value: { $count: { items: { $store: 'modules.call.ongoing' } } } } },
                ' in a call',
              ],
            },
            {
              type: 'we-button',
              props: { size: 'sm', onClick: { $action: 'modules.call.joinSpaceCall' } },
              children: ['Join'],
            },
          ],
        },
      },
    },

    // ── In a call ────────────────────────────────────────────────────────────
    then: {
      type: 'Row',
      props: {
        position: 'fixed',
        top: CALL_BAR_TOP,
        left: '50%',
        transform: 'translateX(-50%)',
        bg: 'neutral-0',
        border: '1px solid neutral-200',
        r: 'pill',
        shadow: 'lg',
        py: '200',
        px: '300',
        gap: '200',
        ay: 'center',
        zIndex: 'sticky',
      },
      children: [
        mediaToggle({
          on: 'microphone',
          off: 'microphone-slash',
          enabled: 'modules.call.media.audioEnabled',
          action: 'modules.call.toggleAudio',
        }),
        mediaToggle({
          on: 'video-camera',
          off: 'video-camera-slash',
          enabled: 'modules.call.media.videoEnabled',
          action: 'modules.call.toggleVideo',
        }),
        mediaToggle({
          on: 'monitor',
          off: 'monitor',
          enabled: 'modules.call.media.screenShareEnabled',
          action: 'modules.call.toggleScreenShare',
        }),
        { type: 'we-divider', props: { orientation: 'vertical', height: '20px' } },
        {
          type: 'we-button',
          props: { size: 'sm', variant: 'ghost', onClick: { $action: 'modules.call.toggleStage' } },
          children: [
            {
              type: 'we-icon',
              props: {
                name: { $if: { condition: { $store: 'modules.call.expanded' }, then: 'caret-down', else: 'caret-up' } },
              },
            },
            {
              type: 'we-number',
              props: { value: { $count: { items: { $store: 'modules.call.tiles' } } } },
            },
          ],
        },
        {
          type: 'we-button',
          props: { size: 'sm', variant: 'danger', onClick: { $action: 'modules.call.leave' } },
          children: [{ type: 'we-icon', props: { name: 'phone-x' } }],
        },
      ],
    },
  },
};

/** Whatever went wrong, said out loud. A call that silently fails to start is indistinguishable from
 *  one nobody has joined. */
const problem: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'modules.call.problem' },
    then: {
      type: 'Row',
      props: {
        position: 'fixed',
        top: CALL_BAR_TOP,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 'sticky',
        maxWidth: '420px',
      },
      children: [
        {
          type: 'we-alert',
          props: { variant: 'warning', dismissible: true, onClose: { $action: 'modules.call.dismissProblem' } },
          children: [{ $store: 'modules.call.problem' }],
        },
      ],
    },
  },
};

/**
 * Start a call about a particular thing — "the call on this post".
 *
 * Exported as a named schema so a template places it where it makes sense (a post's action row, a
 * kanban card's menu), because only the template knows what a node *is*. `$node.id` is supplied by
 * whatever `$each` context it is dropped into.
 */
const anchoredCallButton: SchemaNode = {
  type: 'we-button',
  props: {
    variant: 'ghost',
    size: 'sm',
    onClick: { $action: 'modules.call.joinAnchoredCall', args: ['$node.id'] },
  },
  children: [{ type: 'we-icon', props: { name: 'phone-call' } }],
};

/** A bare "start a call here" trigger, for templates that want one in their own chrome. */
const startCallButton: SchemaNode = {
  type: 'we-button',
  props: { variant: 'ghost', size: 'sm', onClick: { $action: 'modules.call.joinSpaceCall' } },
  children: [{ type: 'we-icon', props: { name: 'phone-call' } }],
};

export const callModule = defineModule({
  id: 'call',
  name: 'Calls',
  description: 'Audio, video and screen share with the people in a space.',
  icon: 'phone-call',

  // Displayed at install, never scored. These three are the whole reason a user should think twice
  // before installing a call module from a stranger.
  capabilities: ['microphone', 'camera', 'screen-share', 'slot:dock-bottom'],

  // No `backends`: signalling goes through the ephemeral port, so this runs on anything that
  // implements one. No `frameworks`: every piece of UI here is a fragment.

  schemas: { anchoredCallButton, startCallButton, tile },

  // What the transcriber listens to. Declared rather than wired: this module knows it has a
  // microphone open, and only the host knows who else might want to hear it.
  audioSource: 'localAudio',

  // Drawn by the host's module rail. No `activeWhen`: this starts a call rather than toggling a
  // panel, and once you are in one the call bar is the thing that shows it — a highlighted rail tab
  // as well would be saying it twice.
  launcher: { icon: 'phone-call', label: 'Start call', action: 'joinSpaceCall', availableWhen: 'canCall' },

  slots: [
    { anchor: 'dock-bottom', node: bar, order: 100 },
    { anchor: 'dock-bottom', node: stage, order: 90 },
    { anchor: 'dock-bottom', node: problem, order: 80 },
  ],

  createStore: (deps: ModuleStoreDeps) => createCallStore(deps),
});
