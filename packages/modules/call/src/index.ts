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
import { defineModule, type ModuleStoreDeps, type SchemaNode } from '@we/schema-shared';

import { createCallStore } from './store';

export { createCallMesh, type CallMesh, type SignallingChannel } from './mesh';
export { createMediaController, type MediaController, type MediaState } from './media';
export { anchoredCallId, CALL_PROTOCOL_VERSION, parseCallMessage, spaceCallId } from './protocol';
export { createCallStore, type CallTile } from './store';

/** One participant's video, or their avatar when there is nothing to show. */
const tile: SchemaNode = {
  type: 'Column',
  props: {
    position: 'relative',
    bg: 'neutral-900',
    r: '400',
    overflow: 'hidden',
    minWidth: '160px',
    flex: '1',
    ax: 'center',
    ay: 'center',
  },
  children: [
    {
      type: '$if',
      props: {
        // A tile with no stream yet is normal for the first second or two of a join, and a peer with
        // their camera off never gets one at all. Both show the avatar rather than a black rectangle.
        condition: { $and: ['$tile.stream', { $or: ['$tile.videoEnabled', '$tile.isScreen'] }] },
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
            fit: { $if: { condition: '$tile.isScreen', then: 'contain', else: 'cover' } },
          },
        },
        else: {
          type: 'we-avatar',
          props: { image: '$tile.avatar', initials: '$tile.name', size: 'lg' },
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
            condition: { $not: '$tile.audioEnabled' },
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
            condition: '$tile.isScreen',
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
            condition: { $in: ['$tile.connection', ['connecting', 'disconnected', 'failed']] },
            then: {
              type: 'we-badge',
              props: { variant: 'warning', size: 'xs' },
              children: ['$tile.connection'],
            },
          },
        },
      ],
    },
  ],
};

/** The expanded stage — every participant, above the bar. */
const stage: SchemaNode = {
  type: '$if',
  props: {
    condition: { $and: [{ $store: 'modules.call.active' }, { $store: 'modules.call.expanded' }] },
    then: {
      type: 'Grid',
      props: {
        position: 'fixed',
        bottom: '900',
        left: '400',
        right: '400',
        height: '40vh',
        minChildWidth: '220px',
        gap: '300',
        p: '300',
        bg: 'neutral-1000',
        r: '500',
        shadow: 'xl',
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
    // Only shown when somebody else is, so an empty space carries no chrome at all. Starting a call
    // from nothing belongs on a deliberate affordance, not on persistent furniture.
    else: {
      type: '$if',
      props: {
        condition: { $count: { items: { $store: 'modules.call.ongoing' } } },
        then: {
          type: 'Row',
          props: {
            position: 'fixed',
            bottom: '400',
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
        bottom: '400',
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
        bottom: '400',
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
  slots: [
    { anchor: 'dock-bottom', node: bar, order: 100 },
    { anchor: 'dock-bottom', node: stage, order: 90 },
    { anchor: 'dock-bottom', node: problem, order: 80 },
  ],

  createStore: (deps: ModuleStoreDeps) => createCallStore(deps),
});
