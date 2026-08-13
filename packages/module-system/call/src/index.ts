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
export { type CallDockEdge, type CallPlacement, type CallTile, type CallTileState, createCallStore } from './store';

/**
 * Where the call's chrome sits.
 *
 * At the top, where your eyes already are. That is not where this started: the bar was docked at the
 * bottom and only *appeared* at the top because `bottom: '400'` is not a CSS length, so the offset was
 * dropped and `position: fixed` fell back to the static position. The accident read better than the
 * design, so it is now the design — a call you are in should be visible where you are looking, not
 * competing with whatever the space puts along the bottom.
 *
 * The stage no longer derives an offset from this. It used to: a second constant here restated the
 * bar's height so the two would stack, which is a relationship nothing enforced. The stage is a
 * *dock* now, and where a dock lands is the host's business — see `docks` at the bottom of this file.
 */
const CALL_BAR_TOP = '10px';

/**
 * The bar's extension point, for chrome that belongs *in a call* rather than at a screen edge.
 *
 * Exported so a contributing module names the same string this one renders, without either importing
 * the other. That is the whole point: transcription's toggle belongs beside mute and camera, and the
 * alternative — this module referencing `modules.transcribe.*` in its own schema — would leave a
 * button wired to nothing the moment that module were uninstalled.
 */
export const CALL_CONTROLS_ANCHOR = 'call-controls';

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

/** The same lookup for a participant's picture and name, which are late-arriving for the same reason. */
const faceOf = (field: string) => ({
  $find: { items: { $store: 'modules.call.tileFaces' }, where: { id: '$tile.id' }, select: field },
});

/**
 * Whether this tile is showing moving pictures rather than an avatar.
 *
 * Read from the store rather than assembled here, and that is the fix for the blank tile: this used
 * to ask whether `$tile.stream` existed, and a peer's stream object exists from the moment they join
 * the roster — empty, until tracks arrive. So every joining peer rendered a `<video>` over nothing
 * and painted black for the whole negotiation. `hasPicture` asks whether there is a live video
 * track, which is the question that was meant all along.
 *
 * Named once and used in three places, because they have to agree and disagreeing is invisible: the
 * tile would show a face in the middle *and* again in the corner, or a screen share with nothing to
 * say whose it is.
 */
const hasVideo = stateOf('hasPicture');

/**
 * One participant: a picture the right shape, and everything that belongs on top of it.
 *
 * Two boxes rather than one, and the split is what fixed the overlays. The outer box is the grid
 * cell — whatever proportions the panel happens to have, which for one person in a side dock is
 * 440×900. The inner box is the picture, sized to the largest 16:9 that fits, so the name and the
 * badges anchored to its corner land *on the video* instead of somewhere in the empty half of a
 * cell they nominally shared.
 */
const tile: SchemaNode = {
  type: 'Column',
  props: {
    ax: 'center',
    ay: 'center',
    /**
     * The cell takes what it is given and never asks for more.
     *
     * `minWidth`/`minHeight: 0` are the load-bearing pair, not the sizes. A grid item's automatic
     * minimum size is `auto` — large enough for its content — so a cell holding anything with an
     * intrinsic size pushes its own track wider than the track was meant to be, and the grid
     * overflows a stage that had a perfectly definite height. Zeroing it makes the track
     * authoritative, which is the whole invariant here: one participant can never produce a
     * scrollbar.
     */
    minWidth: '0',
    minHeight: '0',
    /**
     * Grid placement, and the size containment the picture inside is measured against.
     *
     * Looked up by id like the volatile flags above, because the placement depends on the stage's
     * mode as well as on who is focused — see `tileCells` in the store, which is also where the
     * spanning and the containment are explained.
     *
     * Per-item and never by reparenting, deliberately: promoting the focused tile into a separate
     * "spotlight" node would move it to a different DOM parent, Solid's `<For>` recreates rather
     * than moves across parents, and the `<video>` would lose its stream on every click. One
     * container, one `$each`, only CSS changes.
     */
    styles: {
      $find: { items: { $store: 'modules.call.tileCells' }, where: { id: '$tile.id' }, select: 'style' },
    },
  },
  children: [
    {
      type: 'Column',
      props: {
        position: 'relative',
        // Low-numbered, so it stays a recessed surface under both themes — see the note on `stage`.
        // It shows only where a picture cannot fill 16:9, which is a screen share letterboxed inside
        // its own frame rather than a grey box around every camera.
        bg: 'neutral-100',
        r: '400',
        overflow: 'hidden',
        ax: 'center',
        ay: 'center',
        /**
         * A 16:9 box, sized from whichever dimension is the scarce one — see `pictureStyle`.
         *
         * Computed in the store rather than written here because it depends on the placement, and a
         * side dock and a bottom dock are constrained by different axes.
         */
        styles: { $store: 'modules.call.pictureStyle' },
        // A ring on whoever has the stage, so clicking a tile has a visible result even in the moment
        // before the layout settles. On the picture rather than the cell, so it frames the video.
        border: {
          $if: { condition: stateOf('focused'), then: '2px solid primary-500', else: '2px solid transparent' },
        },
      },
      children: [
        {
          type: '$if',
          props: {
            // No video means the avatar, rather than a black rectangle.
            condition: hasVideo,
            then: {
              type: 'we-video',
              props: {
                stream: '$tile.stream',
                autoplay: true,
                playsinline: true,
                // Never hear yourself. The self tile plays the same microphone the mesh is sending, and
                // unmuted it is an immediate feedback loop.
                muted: '$tile.isSelf',
                /**
                 * Pinned to the tile's four edges rather than sized `100%` × `100%`.
                 *
                 * Not a stylistic preference — a percentage height only resolves against a parent whose
                 * own height is definite, and every "definite" in a chain of stretched flex and grid
                 * items is a browser judgement call rather than a guarantee. When one of them decides
                 * otherwise the percentage becomes `auto`, and an element whose only child is out of
                 * flow is then zero pixels tall: an invisible video rather than an oversized one. An
                 * absolutely positioned box with all four offsets set has a used size that comes from
                 * the containing block directly, so there is no chain left to fail.
                 *
                 * The tile is `position: relative`, which is what makes it the containing block.
                 */
                position: 'absolute',
                top: '0',
                right: '0',
                bottom: '0',
                left: '0',
                /**
                 * `cover` for a camera, `contain` for a desktop.
                 *
                 * Safe again now that the box is 16:9 rather than whatever shape the panel is. It was
                 * not before: one participant in a right-hand dock got a 440×900 cell, and covering it
                 * scaled a 16:9 face to 1600px wide and threw away 1160px of it, leaving a vertical
                 * slice of somebody's nose. Against a box that already matches, `cover` crops nothing
                 * from a 16:9 source and trims a 4:3 webcam the way every other call app does.
                 *
                 * A desktop still gets `contain` — cropping one is the difference between readable and
                 * not — and the recessed background behind it makes the letterboxing look deliberate.
                 *
                 * Setting `fit` at all is also what pins the video inside the box: without it the
                 * element sizes itself from the stream's own pixel dimensions. See the primitive.
                 */
                fit: { $if: { condition: stateOf('isScreen'), then: 'contain', else: 'cover' } },
                /**
                 * Your own camera, mirrored — everyone expects to raise the hand they raised.
                 *
                 * Only the camera. A mirrored screen share is unreadable text, and `isScreen` is exactly
                 * the flag that tells the two apart.
                 */
                transform: {
                  $if: {
                    condition: { $and: ['$tile.isSelf', { $not: stateOf('isScreen') }] },
                    then: 'scaleX(-1)',
                    else: 'none',
                  },
                },
              },
            },
            /**
             * No video: who this is, and why there is nothing to watch.
             *
             * The second half is the part that was missing. A peer still negotiating and a peer who has
             * turned their camera off both rendered as a bare avatar, so the first seconds of a working
             * call were indistinguishable from a broken one — and the only honest thing to do while
             * waiting is to say that you are waiting.
             */
            else: {
              type: 'Column',
              props: { gap: '200', ax: 'center', ay: 'center' },
              children: [
                {
                  /**
                   * The participant's actual picture, with a generated one from their DID behind it.
                   *
                   * Looked up rather than read off `$tile`, because a profile arriving is not a reason to
                   * remount a video — see `tileFaces` in the store. `hash` is always supplied, so an agent
                   * with no picture still gets a distinct and stable one rather than the same grey glyph
                   * as everybody else.
                   */
                  type: 'we-avatar',
                  props: {
                    image: faceOf('image'),
                    hash: faceOf('hash'),
                    initials: faceOf('name'),
                    size: 'lg',
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: stateOf('connecting'),
                    then: {
                      type: 'Row',
                      props: { gap: '100', ay: 'center' },
                      children: [
                        { type: 'we-spinner', props: { size: 'xs' } },
                        {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'neutral-500' },
                          children: ['Connecting…'],
                        },
                      ],
                    },
                    // Failure is not progress and must not animate like it. Nothing at all for the
                    // ordinary case — a connected peer with their camera off needs no explanation, and
                    // labelling it would be noise on every tile of every call.
                    else: {
                      type: '$if',
                      props: {
                        condition: stateOf('failed'),
                        then: {
                          type: 'Row',
                          props: { gap: '100', ay: 'center' },
                          children: [
                            { type: 'we-icon', props: { name: 'warning', size: 'xs', color: 'danger-500' } },
                            {
                              type: 'we-text',
                              props: { variant: 'footnote', color: 'danger-500' },
                              children: ["Couldn't connect"],
                            },
                          ],
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
        /**
         * Click anyone to give them the stage; click them again to go back to an even grid.
         *
         * A `bare` button covering the tile rather than an `onClick` on the tile itself: bare is the
         * appearance-free variant, so it adds nothing visually while keeping the keyboard activation and
         * the button role that a clickable `Column` silently loses. It sits under the badges in DOM
         * order so those stay readable, and above the video so the whole picture is the target.
         */
        {
          type: 'we-button',
          props: {
            variant: 'bare',
            position: 'absolute',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            onClick: { $action: 'modules.call.focusTile', args: ['$tile.id'] },
          },
        },
        {
          type: 'Row',
          props: { position: 'absolute', bottom: '200', left: '200', gap: '100', ay: 'center' },
          children: [
            /**
             * Whose tile this is — the question a wall of faces stops answering the moment one of them
             * turns their camera off, or shares a screen that looks like everybody else's.
             *
             * In the same row as the badges rather than its own corner, so the two cannot overlap on a
             * small tile: one absolutely positioned strip, laid out left to right, name first.
             */
            {
              type: '$if',
              props: {
                // Nothing at all rather than an empty chip, for a peer whose profile has not arrived.
                // Your own tile always has something to say, so it is exempt.
                condition: { $or: ['$tile.isSelf', faceOf('name')] },
                then: {
                  type: 'we-badge',
                  props: { variant: 'neutral', size: 'xs', maxWidth: '150px' },
                  children: [
                    {
                      /**
                       * The small avatar appears only while video is playing.
                       *
                       * With the camera off the large avatar is already in the middle of the tile, and a
                       * second copy of the same face two centimetres below it is noise. While video is
                       * playing it is the opposite: a shared desktop carries no clue whose it is.
                       */
                      type: '$if',
                      props: {
                        condition: hasVideo,
                        then: {
                          type: 'we-avatar',
                          props: {
                            image: faceOf('image'),
                            hash: faceOf('hash'),
                            initials: faceOf('name'),
                            size: 'xxs',
                          },
                        },
                      },
                    },
                    {
                      type: 'we-text',
                      // `minWidth: 0` is what lets `truncate` actually bite: a flex item's automatic
                      // minimum is its content, so without it a long name pushes the badge wider than
                      // its own `maxWidth` instead of being clipped.
                      props: { variant: 'footnote', truncate: true, minWidth: '0' },
                      // "You" rather than your own name: it is shorter, and it is the thing you are
                      // actually looking for when scanning a grid for your own picture.
                      children: [{ $if: { condition: '$tile.isSelf', then: 'You', else: faceOf('name') } }],
                    },
                  ],
                },
              },
            },
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
              // Reconnecting is worth saying out loud — a frozen picture looks identical to a still one.
              //
              // Only where there is a picture to freeze: with no video the centre of the tile already
              // says what is happening, and a badge repeating it two centimetres below would be the same
              // sentence twice.
              type: '$if',
              props: {
                condition: {
                  $and: [hasVideo, { $in: [stateOf('connection'), ['connecting', 'disconnected', 'failed']] }],
                },
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
    },
  ],
};

/**
 * The stage — every participant, in the box the host has given the dock.
 *
 * It positions nothing. That is the change: this used to be a `position: fixed` overlay carrying
 * `right: '72px'`, a hardcoded copy of the module rail's width that nothing kept in step, and a
 * `38vh` height that turned out to be a floor rather than a ceiling. Where the panel sits, how big
 * it is, and whether it insets the app or floats over it are all the host's now — this module only
 * says which edge and how much, through the store keys named in `docks` below.
 *
 * `overflow: hidden`, not `auto`, and that is a statement rather than a detail: the grid divides a
 * definite box, so content that does not fit is a bug to be seen rather than a scrollbar to be
 * lived with. One participant can never produce one.
 *
 * Colours stay theme-relative, and that matters more than it looks. Dark themes invert the neutral
 * scale (`multiplier: -1`), so `neutral-1000` is black in the light theme and near-white in the dark
 * one — which is exactly how this shipped as a white stage. There is no "always dark" neutral; a
 * surface that must follow the theme has to use the same low-numbered tokens as the rest of the app.
 */
const stage: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'modules.call.active' },
    then: {
      type: 'Column',
      props: {
        width: '100%',
        height: '100%',
        p: '300',
        gap: '300',
        overflow: 'hidden',
        // Grid template and track sizing — see `stageStyle` in the store, which is also where the
        // choice of grid over wrapping flex is argued.
        styles: { $store: 'modules.call.stageStyle' },
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

/**
 * Where the video goes — the one control that used to be three.
 *
 * A menu rather than buttons in the bar, because the choice is made once and then left alone, and
 * six permanent options would cost more room in the one piece of chrome that must stay small than
 * the setting is worth. It absorbed the mode cycle and the three size buttons: floating and full
 * screen are placements like any other, and size is dragged now rather than chosen.
 *
 * `triggerLabel` is set explicitly. Left off, `DropdownMenu` falls back to "Options" — the least
 * informative word available for a menu that always has a subject, and the reason this one read as
 * a mystery rather than as a place to put the video.
 */
const placementMenu: SchemaNode = {
  type: 'DropdownMenu',
  props: {
    triggerIcon: 'layout',
    triggerLabel: 'Position',
    // Matching the bar's other controls. `we-button` defaults to `md`, so without this the trigger
    // simply stood taller than everything beside it.
    size: 'sm',
    placement: 'bottom',
    items: {
      $map: {
        items: { $store: 'modules.call.placementOptions' },
        // Toggles rather than actions, for the check mark: an action item has no way to show which
        // placement is the current one, and a menu that cannot answer "where is it now?" is a menu
        // you have to open twice. Toggles also leave it open, which is what you want while trying
        // placements against the space behind them.
        select: {
          id: '$item.id',
          type: 'toggle',
          label: '$item.label',
          icon: '$item.icon',
          checked: '$item.active',
          onToggle: { $action: 'modules.call.setPlacement', args: ['$item.id'] },
        },
      },
    },
  },
};

/**
 * Show the video, or put it away.
 *
 * The other half of what one button used to do alone, and the reason that button could not have a
 * clear icon: it was cycling visibility, placement and size together, so a caret pointed in a
 * direction that meant nothing once the panel was docked to the right.
 *
 * Reads as "N people — click to see them", and follows the same active-variant convention as the
 * mute and camera toggles beside it, so the bar has one idea of what "on" looks like.
 */
const participantsToggle: SchemaNode = {
  type: 'we-tooltip',
  props: {
    title: { $if: { condition: { $store: 'modules.call.stageOpen' }, then: 'Hide video', else: 'Show video' } },
    placement: 'bottom',
  },
  children: [
    {
      type: 'we-button',
      props: {
        size: 'sm',
        variant: { $if: { condition: { $store: 'modules.call.stageOpen' }, then: 'secondary', else: 'ghost' } },
        onClick: { $action: 'modules.call.toggleStage' },
      },
      children: [
        {
          type: 'we-icon',
          props: {
            /**
             * The action, not the subject.
             *
             * A person glyph says what the button is *about* and nothing about what pressing it
             * does — and since the count beside it already names the subject, the icon was spending
             * the only other slot repeating it. Expanding and contracting arrows say the one thing
             * left to say, and swap so the button always shows the move it is offering.
             */
            name: { $if: { condition: { $store: 'modules.call.stageOpen' }, then: 'arrows-in', else: 'arrows-out' } },
          },
        },
        { type: 'we-number', props: { value: { $count: { items: { $store: 'modules.call.tiles' } } } } },
      ],
    },
  ],
};

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
              // `ongoing` returns faces rather than presence records — see the store. Handing an
              // avatar something with no `image` or `hash` gets the generic person glyph, once per
              // participant, which is what this used to be.
              props: { avatars: { $store: 'modules.call.ongoing' }, size: 'sm', max: 4 },
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
        // Swaps ends when the video is docked along the top, which is the only placement that wants
        // the same corner of the screen as this does. See `barAtBottom`.
        top: { $if: { condition: { $store: 'modules.call.barAtBottom' }, then: 'auto', else: CALL_BAR_TOP } },
        bottom: { $if: { condition: { $store: 'modules.call.barAtBottom' }, then: CALL_BAR_TOP, else: 'auto' } },
        /**
         * Centred on the content, not the window.
         *
         * Every other piece of floating chrome moves when a dock takes an edge — the module rail,
         * the editor's rails and its toolbar all slide inwards. A bar pinned to the middle of the
         * *window* stays put while they move, so docking on the right walked the editor's controls
         * straight into it. Shifting by half the difference between the insets keeps it in the
         * middle of what is left, which is where it was always meant to be.
         */
        left: 'calc(50% + (var(--we-sidebar-width, 0px) + var(--we-dock-left, 0px) - var(--we-dock-right, 0px)) / 2)',
        transform: 'translateX(-50%)',
        transition: 'left var(--we-chrome-transition, 300ms) ease',
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
        {
          // Where other modules put their call controls — see `anchors` below. The marker is replaced
          // by whatever is contributed, or by nothing at all, so the bar has no gap when no module
          // has joined it and this module never learns which ones did.
          type: '$slot',
          props: { anchor: CALL_CONTROLS_ANCHOR },
        },
        { type: 'we-divider', props: { orientation: 'vertical', height: '20px' } },
        participantsToggle,
        placementMenu,
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
        /*
          The end the call bar is not at.

          Both were pinned to `CALL_BAR_TOP`, so the alert opened underneath the controls — mostly
          hidden, and with its dismiss button unreachable, which is a poor showing for the one piece
          of UI whose entire job is to be read. `barAtBottom` already tracks which end the bar took;
          taking the other one needs no new state and cannot collide by construction.
        */
        top: { $if: { condition: { $store: 'modules.call.barAtBottom' }, then: CALL_BAR_TOP, else: 'auto' } },
        bottom: { $if: { condition: { $store: 'modules.call.barAtBottom' }, then: 'auto', else: CALL_BAR_TOP } },
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
  capabilities: ['microphone', 'camera', 'screen-share', 'slot:dock-bottom', 'dock'],

  // No `backends`: signalling goes through the ephemeral port, so this runs on anything that
  // implements one. No `frameworks`: every piece of UI here is a fragment.

  schemas: { anchoredCallButton, startCallButton, tile },

  // What the transcriber listens to. Declared rather than wired: this module knows it has a
  // microphone open, and only the host knows who else might want to hear it.
  audioSource: 'localAudio',

  // Opens the control bar to other modules. Declared so the registry can report chrome aimed at an
  // anchor nobody provides, which otherwise renders nowhere and looks like a module switched off.
  anchors: [CALL_CONTROLS_ANCHOR],

  // Drawn by the host's module rail. No `activeWhen`: this starts a call rather than toggling a
  // panel, and once you are in one the call bar is the thing that shows it — a highlighted rail tab
  // as well would be saying it twice.
  launcher: { icon: 'phone-call', label: 'Start call', action: 'joinSpaceCall', availableWhen: 'canCall' },

  slots: [
    { anchor: 'dock-bottom', node: bar, order: 100 },
    { anchor: 'dock-bottom', node: problem, order: 80 },
  ],

  /**
   * The stage, as a panel the host places rather than chrome that places itself.
   *
   * The distinction the bar above makes clear by contrast. Both are call chrome; only one of them
   * should take room. You glance at the bar while doing something else, so it overlays — shrinking
   * the app for a row of buttons would be absurd. You *watch* the stage, usually while reading the
   * space beside it, and a panel that covers what you are reading is a panel you keep closing.
   *
   * Three store keys and no geometry. The module cannot see the sidebar's width, the module rail's,
   * or the size of the window, and the previous version's `right: '72px'` was a copy of one of
   * those that nothing kept in step. Saying "the right edge, medium" and letting the host answer is
   * what makes the same declaration inset on a monitor and float on a laptop.
   */
  docks: [{ edge: 'dockEdge', size: 'dockSize', float: 'dockFloat', node: stage }],

  createStore: (deps: ModuleStoreDeps) => createCallStore(deps),
});
