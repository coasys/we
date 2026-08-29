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
/*
  A compile-time dependency, and the only kind a module may have on a shape.

  `@we/schema-kit` is the portable half of the fragment kit — nothing in it names a store, so it
  carries no assumption about the deployment this module lands in. The functions run during this
  package's build and what ships in `dist` is the data they returned, so there is no runtime
  coupling, nothing for the host to provide, and no version for the two to agree on. That is why it
  is a devDependency here rather than a peer, unlike `@we/module-shared` and `@we/schema-shared`.
*/
import { peopleTooltip } from '@we/schema-kit';
import { expr, type SchemaNode } from '@we/schema-shared';

import { devPeersAvailable } from './devPeers';
import { createCallStore } from './store';

export { createCallMesh, type CallMesh, type SignallingChannel } from './mesh';
export { createMediaController, type MediaController, type MediaState } from './media';
export {
  CALL_KIND,
  CALL_PREDICATE,
  CALL_PROTOCOL_VERSION,
  callRecordId,
  parseCallMessage,
  recordCallId,
} from './protocol';
export { type CallDockEdge, type CallTile, type CallTileState, createCallStore } from './store';

/**
 * How far the call's chrome sits off the bottom edge.
 *
 * The bottom, and the reason is a property of *panels* rather than a preference about calls: a panel
 * has a titlebar and no footer. Chrome along the top covers the grip, the position menu and the
 * button that un-maximises — the three controls a panel is recovered with — so a bar up there is a
 * bar that can strand a panel. Along the bottom it covers nothing that is pressed, which is what
 * lets a maximised panel take the whole window.
 *
 * The second reason is templates. A page with a sticky header locks it to the top of the *content*,
 * and a bar fixed over that collides with it on every scroll — structurally, not by a few pixels
 * that could be tuned away. Nothing a template can do fixes that: it would have to know a module's
 * bar exists, and its header would jump down the moment somebody started a call. It is also where
 * every other call application puts these controls.
 *
 * It was at the top, and got there by accident — `bottom: '400'` is not a CSS length, so the offset
 * was dropped and `position: fixed` fell back to the static position. The accident read well enough
 * to be adopted deliberately, which held until panels could be maximised and templates grew sticky
 * headers.
 *
 * The stage no longer derives an offset from this. It used to: a second constant here restated the
 * bar's height so the two would stack, which is a relationship nothing enforced. The stage is a
 * *dock* now, and where a dock lands is the host's business — see `docks` at the bottom of this file.
 */
const CALL_BAR_INSET = '10px';

/**
 * A strip across one edge of the content, for chrome that is centred on it rather than pinned to a
 * corner. The bar, the join prompt and the problem alert all sit in one.
 *
 * ## Why a strip, and not a centred box
 *
 * The bars used to centre themselves — `left: 50% + --we-chrome-center-x`, `translateX(-50%)` —
 * which is right for as long as the content is wider than the bar and wrong the moment it is not:
 * a box centred on a space too narrow for it overhangs both sides equally, and the half that
 * crosses the sidebar leaves the window. That is what a panel taking enough of the right did to
 * the call controls, hang-up button first.
 *
 * A strip spanning the content's edges, with the bar as its one flex child under `justify-content:
 * safe center`, is the same centring while the bar fits and a clamp when it does not — `safe`
 * means "centre, unless that would overflow, in which case align to start". No measurement, no
 * second position to keep in step with the first, and the strip's edges are the same four numbers
 * the content is laid out from, so it slides with a dock exactly as the centred box did.
 *
 * Which end is the start is the host's call, published as `--we-chrome-give`: the side with the
 * deeper dock, so a bar that cannot fit covers the panel that squeezed it rather than the sidebar
 * or the window's edge. See the shell store for the reasoning.
 *
 * ## What the strip clears
 *
 * `--we-chrome-<edge>` is where the host says the content's edge is, so this clears a docked
 * panel along that edge as it clears a docked call stage. A panel that merely *floats* there is
 * deliberately not dodged: it takes no room, the user put it there by hand, and moving out of its
 * way would be chrome running from a decision somebody just made — worse than an overlap they can
 * see and undo. The asymmetry that makes that safe at the bottom would not hold at the top: a
 * panel's controls are all in its titlebar, so an overlap at the bottom covers content rather than
 * the way out.
 *
 * ## Why the strip is a `$surface`
 *
 * The strip's width is the content's width, which is exactly the number the bar needs in order to
 * decide how much of itself to show — see `COMPACT`. A surface is the one mechanism the system has
 * for a schema to read its own room, and it needs a box whose inline size is decided from outside,
 * which a strip pinned at both ends is and a shrink-to-fit bar is not.
 *
 * The strip passes pointer events through, since it spans the whole edge and would otherwise
 * swallow every click along the bottom of the content; the child has to switch them back on.
 */
function contentCentred(edge: 'top' | 'bottom', child: SchemaNode): SchemaNode {
  const ease = (property: string) => `${property} var(--we-chrome-transition, 300ms) ease`;
  return {
    type: 'Column',
    props: {
      position: 'fixed',
      left: 'var(--we-chrome-left, 0px)',
      right: 'var(--we-chrome-right, 0px)',
      [edge]: `calc(${CALL_BAR_INSET} + var(--we-chrome-${edge}, 0px))`,
      transition: [ease('left'), ease('right'), ease(edge)].join(', '),
      zIndex: 'sticky',
      pointerEvents: 'none',
    },
    children: [
      {
        type: '$surface',
        props: {
          // The surface fills a column by default; this one is a row that hugs its edge.
          styles: {
            height: 'auto',
            'flex-direction': 'var(--we-chrome-give, row)',
            'justify-content': 'safe center',
          },
        },
        children: [child],
      },
    ],
  };
}

/**
 * When the bar folds its secondary controls away.
 *
 * `base` is the strip's tier below 640px of content — a phone, or a desktop with enough docked
 * beside the space that the full row would not fit. The full bar runs to six hundred pixels with
 * a contributed control or two; below that width the strip above keeps it on screen by letting it
 * overlap the dock, which is survivable and not good. Compact, it is about half as wide: the
 * readout keeps its faces and loses its sentence, and everything that is not mute, camera, or
 * hang-up moves into one menu.
 *
 * One tier rather than a gradual collapse, because a control that moves at 700 and another at 500
 * is a bar nobody can learn. The rule is: below `base` it is the small bar, otherwise the whole
 * one, and both are one schema with these two gates in it rather than two schemas that drift.
 *
 * The same question the mobile plan asks, answered once — a narrow window and a narrow content
 * box are the same problem to a bar, and the surface reports them as one number.
 */
const COMPACT = { $: "surface.tier == 'base'" };
const ROOMY = { $: "surface.tier != 'base'" };
const whenRoomy = (node: SchemaNode): SchemaNode => ({
  type: '$if',
  props: { condition: ROOMY, then: node },
});
const whenCompact = (node: SchemaNode): SchemaNode => ({ type: '$if', props: { condition: COMPACT, then: node } });

/**
 * The bar's own corners, following the theme's **control** radius.
 *
 * It was a flat `pill`, so a theme set to Sharp drew a fully rounded bar around square-cornered
 * buttons — the one shape in the app that ignored the shape presets.
 *
 * `controlRadius` rather than `surfaceRadius`, and the distinction is what the two categories are
 * for. A surface is a sheet with content on it — a modal, a drawer, a docked panel — and its radius
 * is about the material. This is a cluster of buttons and nothing else, drawn tight around them, so
 * its corners are a statement about controls; under the Pill preset (controls pill, surfaces 600) a
 * surface-radius bar would be a 16px box around pill buttons, the same mismatch mirrored. The
 * editor's history and mode clusters already read this var for the same reason, while its save and
 * close panel reads the surface one.
 *
 * The fallback is what **Default** looks like, since that preset sets no variable at all — so it has
 * to be a real answer rather than the hardcoded `pill` this started as, which left three of the four
 * presets working and the fourth indistinguishable from Pill. `400` is that answer because it is
 * `we-button`'s own default: on Default the bar and the buttons inside it are both 8px, which is the
 * same relationship every other preset gives them.
 *
 * Not the concentric `inner + padding`, which would be `600` here and reads better in isolation. That
 * figure is only right while the padding is, and the radius is a theme variable: a theme set to Sharp
 * would then draw a bar with 8px corners around perfectly square buttons — this bug again, smaller.
 * It also collided with Rounded, which sets controls to `600` outright. Matching the controls exactly
 * is the one rule that survives all four presets, and it is what the editor's own history and mode
 * clusters do.
 *
 * A theme that states a control radius of its own still wins — several of the built-in ones do.
 */
const BAR_RADIUS = 'var(--we-theme-control-radius, var(--we-radius-400))';

/**
 * The bar's surface, matching the app's other floating control clusters.
 *
 * It was `neutral-0` with a `lg` shadow — a *sheet*, which is what the app uses for something with
 * content on it: a dropdown, a modal, the panel the editor's share button opens. A cluster of
 * buttons is not that, and read as a different material sitting a centimetre off the page beside
 * the editor's undo/redo and save/close bars, which are `neutral-50` with a border and no shadow at
 * all. The module rail is the same recessed surface.
 *
 * The shadow stays, at the rail's weight rather than its own. The editor's bars can do without one
 * because they appear over a dimmed editing surface that already separates them; this floats over
 * whatever a space happens to be showing, and a border alone against a busy background is not a
 * separation.
 */
/*
  Page-toned, like the module rail it sits beside — see the long note in ChromeRail.schema.ts.

  The short version: `surface-raised` is a rung on the tonal ladder (page → card → popover), sized
  so a popover clears the card it covers. This bar covers nothing, so taking that rung painted it 11
  lightness points above its surroundings. Chrome separates by edge, which is what the border and
  shadow below are for, and what this bar always did (`neutral-50`).
*/
const BAR_SURFACE = { bg: 'page', border: '1px solid border', shadow: 'md' } as const;

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
 * A second extension point, under the bar rather than inside it — for chrome that *reports* rather
 * than chrome you press.
 *
 * The bar is a row of controls and everything in it is one, so anything with a sentence to say has
 * nowhere to go: an extraction in progress, a model downloading, a sync catching up. Each of those
 * is a strip of text with a duration, and each would otherwise arrive as its own floating bar with
 * its own guess at how far below this one to sit.
 *
 * Away from the edge rather than toward it: the bar is the thing being used, and a status line that
 * pushed the controls off the window would move a target somebody was reaching for. With the bar at
 * the bottom that means *above* — the column runs upward. Contributions stack in a column, so two
 * modules reporting at once read as two rows rather than as a fight over one position.
 *
 * The gap is the column's, not each contributor's. A contributor that had to space itself from the
 * bar would need to know the bar exists, which is the coupling both anchors are here to avoid.
 */
export const CALL_STATUS_ANCHOR = 'call-status';

/**
 * A participant's volatile flag, looked up rather than read off the tile.
 *
 * The tile object carries only identity and stream, because `$each` renders through a
 * reference-keyed `<For>` and any change to the item remounts the row — taking the `<video>` with it.
 * Muting your microphone blanked your own video for exactly that reason.
 *
 * A `find` over the store resolves inside the renderer's prop memo, so reading the signal registers a
 * dependency and the prop updates on its own. The row never remounts; only the badge changes.
 */
const stateOf = (field: string) => ({ $: `find(modules.call.tileStates, { id: tile.id }).${field}` });

/** The same lookup for a participant's picture and name, which are late-arriving for the same reason. */
const faceOf = (field: string) => ({ $: `find(modules.call.tileFaces, { id: tile.id }).${field}` });

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
    styles: { $: 'find(modules.call.tileCells, { id: tile.id }).style' },
  },
  children: [
    {
      /*
        The box the picture is measured against — see `tilePins` in the store.

        Ordinarily it fills the cell and nothing about the tile changes. It earns its place on the
        spotlight while the strip scrolls: that cell spans a column taller than the stage, so a
        picture sized from the cell would be sized for a box mostly off screen. This one is pinned to
        the visible band and carries the size container, so the picture is fitted to what can
        actually be seen.
      */
      type: 'Column',
      props: {
        ax: 'center',
        ay: 'center',
        minWidth: '0',
        minHeight: '0',
        styles: { $: 'find(modules.call.tilePins, { id: tile.id }).style' },
      },
      children: [
        {
          type: 'Column',
          props: {
            position: 'relative',
            // Low-numbered, so it stays a recessed surface under both themes — see the note on `stage`.
            // It shows only where a picture cannot fill 16:9, which is a screen share letterboxed inside
            // its own frame rather than a grey box around every camera.
            bg: 'surface-sunken',
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
            styles: { $: 'modules.call.pictureStyle' },
            // A ring on whoever has the stage, so clicking a tile has a visible result even in the moment
            // before the layout settles. On the picture rather than the cell, so it frames the video.
            border: expr`${stateOf('focused')} ? '2px solid primary-500' : '2px solid transparent'`,
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
                    stream: { $: 'tile.stream' },
                    autoplay: true,
                    playsinline: true,
                    /**
                     * Every tile is silent. The picture is here; the sound is in `audioSink`.
                     *
                     * The self tile always had to be — it plays the microphone the mesh is sending, and
                     * unmuted that is an immediate feedback loop. The peers were unmuted, and that was
                     * the whole of the call's audio path, which is why it kept disappearing: this
                     * element exists only while there is a picture to show, so a peer turning their
                     * camera off, or you putting the stage away, silenced them.
                     *
                     * With the sink carrying the audio, an unmuted tile would be a second decoder on the
                     * same stream — the same voice twice, slightly apart.
                     */
                    muted: true,
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
                    fit: expr`${stateOf('isScreen')} ? 'contain' : 'cover'`,
                    /**
                     * Your own camera, mirrored — everyone expects to raise the hand they raised.
                     *
                     * Only the camera. A mirrored screen share is unreadable text, and `isScreen` is exactly
                     * the flag that tells the two apart.
                     */
                    transform: expr`tile.isSelf && !${stateOf('isScreen')} ? 'scaleX(-1)' : 'none'`,
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
                              props: { variant: 'footnote', color: 'text-muted' },
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
                                { type: 'we-icon', props: { name: 'warning', size: 'xs', color: 'danger-text' } },
                                {
                                  type: 'we-text',
                                  props: { variant: 'footnote', color: 'danger-text' },
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
                onClick: { $action: 'modules.call.focusTile', args: [{ $: 'tile.id' }] },
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
                    condition: expr`tile.isSelf || ${faceOf('name')}`,
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
                          children: [
                            {
                              type: '$if',
                              props: { condition: { $: 'tile.isSelf' }, then: 'You', else: faceOf('name') },
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: expr`!${stateOf('audioEnabled')}`,
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
                    condition: expr`${hasVideo} && ${stateOf('connection')} in ['connecting', 'disconnected', 'failed']`,
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
    condition: { $: 'modules.call.active' },
    then: {
      /*
        A padded box around the tiles, rather than padding on the tiles' own box.

        The two look identical until the strip scrolls, and then they are not: a scrollbar renders at
        the *padding* edge, so a scrolling grid that carried its own padding put its scrollbar flush
        against the panel's border — underneath the 8px resize handle, which is wider than the 6px
        scrollbar and swallowed it whole. Dragging to scroll resized the panel instead.

        Padding the wrapper insets the scroller by that padding, so the scrollbar sits 12px in, clear
        of the handle, and the inset stays symmetrical — which a gutter added to one side would not.
      */
      type: 'Column',
      props: {
        width: '100%',
        height: '100%',
        // `300` is 12px — `STAGE_PADDING_PX`, which `dockAspect` subtracts so that "fit to content"
        // lands on a height that fits the pictures rather than one that squeezes them. Change it
        // here and the constant has to follow.
        p: '300',
        overflow: 'hidden',
      },
      children: [
        {
          type: 'Grid',
          props: {
            width: '100%',
            height: '100%',
            // `300` is 12px — `STAGE_GAP_PX`, which `dockAspect` subtracts alongside the wrapper's
            // padding so that "fit to content" lands on a height that fits the pictures rather than one
            // that squeezes them. The *solver* needs no telling: the grid reads its own gap.
            gap: '300',
            /*
          Scrolls along the strip's axis, and only when the strip is scrolling — see `stageOverflow`.

          `overflow: hidden` the rest of the time, and that is a statement rather than a detail: the
          grid divides a definite box, so content that does not fit is a bug to be seen rather than a
          scrollbar to be lived with. The one exception is a strip holding more people than fit at a
          size worth looking at, which is a list rather than a layout and behaves like one.
        */
            styles: { $: 'modules.call.stageOverflow' },
            /**
             * The arrangement, solved against the box rather than guessed from the head count.
             *
             * This is the whole fix. The columns used to come from how many people were in the call and
             * nothing else, so the panel's shape — the one thing the user controls directly — was not an
             * input: dragged tall and thin you got two columns of postage stamps, dragged wide you got
             * two rows with bands of empty panel above and below. `childAspect` measures the box and
             * picks the arrangement that makes 16:9 pictures largest, which for two people in a square
             * panel is one column at 523px rather than two at 294px.
             *
             * Only CSS changes when it re-solves. That matters more here than anywhere: the tiles are a
             * reference-keyed `$each`, and moving one to a different DOM parent would drop its
             * `srcObject` — somebody's video would go black every time the panel crossed a threshold.
             */
            childAspect: '16 / 9',
            /*
          The spotlight's own tracks, and nothing at all the rest of the time.

          `template` takes precedence over `childAspect`, so this is the whole mode switch: written,
          the equal-tile solve stands down and the spotlight layout takes over; absent, it comes
          back. See `stageTemplate` in the store.
        */
            template: { $: 'modules.call.stageTemplate' },
            rows: { $: 'modules.call.stageRows' },
            // What the stage settled on, back to the store — see `setArrangement`. The host needs it to
            // answer "fit to content".
            onArrange: { $action: 'modules.call.setArrangement' },
            // The box itself, for the one decision the grid cannot make: which edge the strip runs along.
            onMeasure: { $action: 'modules.call.setStageBox' },
          },
          children: [{ type: '$each', props: { items: { $: 'modules.call.tiles' }, as: 'tile' }, children: [tile] }],
        },
      ],
    },
  },
};

/**
 * `−  N  +` — how many synthetic participants the stage is showing.
 *
 * In the bar rather than behind a console incantation, because what this is for is dragging the
 * panel and watching the arrangement re-solve: going to devtools to try five people instead of
 * three breaks exactly the loop it exists to support. Being on screen also means the count cannot be
 * silently left on, which a `localStorage` key set and forgotten very much can — two phantom
 * participants in a real call a week later, with nothing to explain them.
 *
 * Contributed only in a development build, and by a conditional spread at the definition below
 * rather than a `$if` here, so the node does not exist in a production bundle rather than merely
 * rendering nothing in one.
 */
const devPeerControls: SchemaNode = {
  type: 'Row',
  props: { gap: '100', ay: 'center' },
  children: [
    { type: 'we-divider', props: { orientation: 'vertical', height: '26px' } },
    {
      type: 'we-tooltip',
      props: { title: 'One fewer fake participant', placement: 'bottom' },
      children: [
        {
          type: 'we-button',
          props: {
            square: true,
            size: 'sm',
            variant: 'ghost',
            disabled: { $: '!modules.call.fakePeerCount' },
            // Zero-argument, because the schema layer has no arithmetic: there is no way to write
            // "the current count minus one" as a token, so the step belongs in the store.
            onClick: { $action: 'modules.call.removeFakePeer' },
          },
          children: [{ type: 'we-icon', props: { name: 'minus' } }],
        },
      ],
    },
    {
      type: 'we-tooltip',
      props: { title: 'Fake participants — development only', placement: 'bottom' },
      children: [
        {
          type: 'we-text',
          props: { variant: 'label', color: 'text-muted', minWidth: '12px', textAlign: 'center' },
          children: [{ type: 'we-number', props: { value: { $: 'modules.call.fakePeerCount' } } }],
        },
      ],
    },
    {
      type: 'we-tooltip',
      props: { title: 'One more fake participant', placement: 'bottom' },
      children: [
        {
          type: 'we-button',
          props: {
            square: true,
            size: 'sm',
            variant: 'ghost',
            onClick: { $action: 'modules.call.addFakePeer' },
          },
          children: [{ type: 'we-icon', props: { name: 'plus' } }],
        },
      ],
    },
  ],
};

/**
 * A toggle button whose icon and tone follow the state it toggles.
 *
 * No `size`, which means `md` — the default, and one step up from the `sm` the whole bar used to be.
 * These are the controls you reach for mid-sentence while looking at somebody else, so they are
 * worth the extra eight pixels; the bar is still a pill you can ignore. The icons follow on their
 * own, since a sized primitive publishes `--we-context-icon-size` for the icons slotted into it.
 *
 * `square` because there is nothing here but the icon. Without it the button keeps the horizontal
 * padding it holds for a label — 16px a side at `md` — so a 24px glyph sat in a 56px box, and three
 * toggles in a row read as three wide slabs rather than a set of buttons. Square sizes both axes
 * from the component height instead, which is also what the module rail's launchers do.
 *
 * The tooltip is required rather than optional, and names the **move** rather than the state — "Mute"
 * while unmuted, not "Unmuted". An icon-only control has no other way to say what it does, and a
 * microphone with a line through it is genuinely ambiguous about whether it reports a state or offers
 * one. The show/hide toggle beside these already phrased its tooltip that way; this makes the whole
 * bar agree.
 */
function mediaToggle(opts: {
  on: string;
  off: string;
  enabled: string;
  action: string;
  /** What pressing it does while it is on, and while it is off. */
  tip: { on: string; off: string };
}): SchemaNode {
  const toggled = (then: string, otherwise: string) => expr`${{ $: opts.enabled }} ? ${then} : ${otherwise}`;

  return {
    type: 'we-tooltip',
    props: { title: toggled(opts.tip.on, opts.tip.off), placement: 'bottom' },
    children: [
      {
        type: 'we-button',
        props: {
          square: true,
          variant: toggled('secondary', 'ghost'),
          onClick: { $action: opts.action },
        },
        children: [{ type: 'we-icon', props: { name: toggled(opts.on, opts.off) } }],
      },
    ],
  };
}

/**
 * Who is here — a readout, not a control.
 *
 * The count used to be a number sitting inside the show/hide button, which made that button the one
 * thing in the bar that could not be square and put a fact inside a switch: the digit changed when
 * somebody joined, which looks like the control changing state.
 *
 * Separated, it also says the same thing the same way in both halves of this file. The bar you see
 * when you are *not* in the call is faces and "3 in a call"; this is faces and "3 in the call". One
 * sentence, two tenses.
 *
 * Faces come from `tileFaces` rather than from the roster, so a profile arriving fills them in
 * without touching `tiles` — which is what keeps a late avatar from remounting somebody's video.
 * Three, because past that the stack is a smudge at this size and the number is doing the work.
 *
 * ## The roster on hover
 *
 * Three faces and a number answer "how many"; only the list answers "who". It hangs off the whole
 * readout rather than off the avatars, because what a reader points at is the faces *and* the words
 * beside them — a tooltip owned by the stack alone produces nothing when you hover "5 in the call".
 *
 * It lists everyone, not the three that were drawn: the people the stack had to hide are exactly the
 * ones there is no other way to find out about.
 *
 * `peopleTooltip` is the kit's, not this module's. It was written out by hand here first — the kit
 * lived under `templates/` and `modules → templates` is the sideways edge the dependency rules
 * forbid — and that copy is what made the packaging wrong rather than the module unusual, so the
 * portable tier moved to `@we/schema-kit` and this reaches for it like a template would.
 */
const participants: SchemaNode = peopleTooltip({
  items: { $: 'modules.call.tileFaces' },
  image: { $: 'person.image' },
  hash: { $: 'person.hash' },
  name: { $: 'person.name' },
  placement: 'bottom',
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', pl: '100' },
      children: [
        {
          type: 'AvatarStack',
          props: {
            avatars: {
              $: 'modules.call.tileFaces.map(item, { image: item.image, hash: item.hash, initials: item.name })',
            },
            max: 3,
            size: 'sm',
            // The faces overlap, so each needs the surface behind it to show between them.
            ring: '0 0 0 2px var(--we-ring-color)',
          },
        },
        /*
          The sentence is the first thing to go when the bar is short of room — see `COMPACT`. The
          faces stay, and the stack's own "+N" carries the count past three; the roster on hover is
          unchanged, so nothing is lost that was not already a hover away.
        */
        whenRoomy({
          type: 'we-text',
          props: {
            color: 'text-muted',
            /*
            One line, whatever the window does to the bar.

            The bar is shrink-to-fit, so a narrow content box squeezes it — and this readout is the
            only thing in it that can give, every other child being a fixed-size button. Left to
            wrap, "11 in the call" broke between the number and the words and made the whole bar a
            row taller, which moves every control in it.

            Not a design-system prop, and `truncate` is the wrong one: that clips with an ellipsis,
            where the honest behaviour for a bar too narrow for its contents is to overflow. Below
            the compact tier this text is not rendered at all, which is the answer for the widths
            where it actually happened.
          */
            styles: { whiteSpace: 'nowrap' },
          },
          children: [{ type: 'we-number', props: { value: { $: 'count(modules.call.tiles)' } } }, ' in the call'],
        }),
      ],
    },
  ],
});

/**
 * The three toggles that leave the row when it is short of room — declared once, so the square in
 * the bar and the line in the overflow menu are built from the same facts and cannot come to
 * disagree about what a control does or which way round it reads.
 *
 * Each carries two vocabularies, and the split is the point. `tip` is what the *action* would do
 * ("Stop sharing your screen"), which is what a tooltip on a live button should say. `label` is what
 * the control is *about* ("Screen share"), which is what a menu line should say, because a menu
 * carries its state in the tick beside it — a line reading "Stop sharing" with a tick next to it
 * states the same fact twice and in two different grammars.
 *
 * Screen share keeps the same glyph in both states, unlike the mute and camera buttons beside it.
 * `monitor-arrow-up` is a *subject*, not a state: it is your screen, going out. Dropping the arrow
 * while sharing read as the screen leaving — backwards, at the one moment the button has something
 * to report. So the variant carries the state, exactly as it does for the show/hide toggle, and the
 * glyph says what the button is about. Sharing is also the one toggle here with no honest "off"
 * icon: you are either sending a screen or sending nothing, so a slash would be describing a state
 * that does not exist.
 */
interface CallToggle {
  on: string;
  off: string;
  label: string;
  enabled: string;
  action: string;
  tip: { on: string; off: string };
}

const SCREEN_SHARE: CallToggle = {
  on: 'monitor-arrow-up',
  off: 'monitor-arrow-up',
  label: 'Screen share',
  enabled: 'modules.call.media.screenShareEnabled',
  action: 'modules.call.toggleScreenShare',
  tip: { on: 'Stop sharing your screen', off: 'Share your screen' },
};

/**
 * Show the video, or put it away.
 *
 * The other half of what one button used to do alone, and the reason that button could not have a
 * clear icon: it was cycling visibility, placement and size together, so a caret pointed in a
 * direction that meant nothing once the panel was docked to the right.
 *
 * One glyph rather than a pair, like screen share above: `secondary` versus `ghost` says whether the
 * video is showing, which is the same answer every other toggle here gives, and the tooltip names
 * the move. It was `arrows-out`/`arrows-in` — the action rather than the subject — on the grounds
 * that the count beside it named what the button was about. The count is its own readout now, so the
 * arrows were left saying "expand" with no stated object, in a bar where two other buttons also open
 * things.
 */
const STAGE: CallToggle = {
  on: 'video-conference',
  off: 'video-conference',
  label: 'Video',
  enabled: 'modules.call.stageOpen',
  action: 'modules.call.toggleStage',
  tip: { on: 'Hide video', off: 'Show video' },
};

/**
 * Solo — the spotlight with the stage to itself.
 *
 * Only offered while something is focused, which is also the affordance: giving somebody the stage
 * reveals the option to give them all of it. A toggle rather than a third click on the tile,
 * because a three-state cycle on one gesture cannot say which state it is in — see `solo` in the
 * store.
 */
const SOLO: CallToggle = {
  on: 'user',
  off: 'users-three',
  label: 'Spotlight only',
  enabled: 'modules.call.solo',
  action: 'modules.call.toggleSolo',
  tip: { on: 'Show everyone', off: 'Hide the others' },
};

/**
 * One of the toggles above, as a line in the overflow menu rather than a square in the row.
 *
 * The same store key and the same action, so choosing it here is indistinguishable from pressing the
 * button it stands in for. Choosing a toggle deliberately leaves the menu **open**, which is right
 * for a control somebody may want to flip twice.
 *
 * The icon is the "on" glyph in both states, which is exact rather than a shortcut: it is the
 * subject, and only the tick is allowed to say whether the subject is switched on.
 */
function menuToggle(opts: CallToggle) {
  return {
    id: opts.enabled,
    type: 'toggle',
    label: opts.label,
    icon: opts.on,
    checked: { $: opts.enabled },
    onToggle: { $action: opts.action },
  };
}

/**
 * Where the secondary controls go when the row is compact — see `COMPACT`.
 *
 * The design system's `DropdownMenu`, which this could not use until recently: it drew a filled pill
 * for a trigger with no way to say otherwise, and this has to sit in a row of ghost squares as one
 * of them. A hand-rolled `we-popover` around a ghost square stood in, repeating the dropdown's own
 * item metrics and its check glyph by hand — three numbers and a colour that had to be kept in
 * agreement with a component nothing linked them to. `triggerVariant` is the whole of what was
 * missing, and `itemSize` says the rest: `sm` rows, which is what those hand-copied metrics were.
 *
 * Opens upward: the bar is on the bottom edge and there is nothing below it.
 *
 * What is in here is exactly what `whenRoomy` takes out of the row, and it is built from the same
 * three specs, so a toggle cannot be lost in the fold or appear twice. Mute, camera and hang-up
 * never fold: they are the call, and a menu between a person and their microphone is a step too
 * many at the moment they need it.
 *
 * Solo is only offered while something is focused. A `$if` with no `else` resolves to nothing, and
 * the dropdown skips an entry that resolved to nothing — which is what makes a conditional line
 * expressible here at all, and was the second reason this was hand-rolled.
 */
const moreMenu: SchemaNode = {
  type: 'DropdownMenu',
  props: {
    triggerIcon: 'dots-three',
    triggerVariant: 'ghost',
    triggerTitle: 'More controls',
    placement: 'top',
    itemSize: 'sm',
    items: [
      menuToggle(SCREEN_SHARE),
      menuToggle(STAGE),
      // Solo is only offered while something is focused. On the entry rather than around it: an
      // entry carries a handler, which no value expression can hold — see `hidden` on the menu.
      { ...menuToggle(SOLO), hidden: { $: '!modules.call.focusedId' } },
    ],
  },
};

/**
 * The way back to a call happening somewhere else.
 *
 * Only mounted once you have navigated out of the call's space, which is the whole of when it means
 * anything — inside that space the bar is already where the call is, and a button pointing at where
 * you are standing is noise.
 *
 * Deliberately small. The bar is a fixed row of controls and this appears without warning, so it
 * takes an icon and a name and no more: a full sentence would push the mute button off centre every
 * time somebody wandered off. The sentence is in the tooltip, where there is room for it.
 *
 * The name comes from the host's dataset directory and can be empty — a space whose record has not
 * loaded, or one this agent knows only as a uri. The label falls back to something true rather than
 * rendering a button with nothing written on it.
 */
const returnToCall: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.call.elsewhere' },
    then: {
      type: 'we-tooltip',
      props: {
        title: {
          $: "modules.call.callSpace.name ? `Back to the call in ${modules.call.callSpace.name}` : 'Back to the call'",
        },
        placement: 'bottom',
      },
      children: [
        {
          type: 'we-button',
          props: { variant: 'secondary', gap: '200', onClick: { $action: 'modules.call.returnToCall' } },
          children: [
            { type: 'we-icon', props: { name: 'arrow-bend-up-left' } },
            {
              type: 'we-text',
              // Truncated rather than wrapped: a long space name would otherwise make the bar two
              // rows tall, which is the one thing a fixed strip of controls cannot absorb.
              props: { truncate: true, maxWidth: '96px' },
              children: [{ $: "modules.call.callSpace.name ? modules.call.callSpace.name : 'In a call'" }],
            },
          ],
        },
      ],
    },
  },
};

/** The bar, in its two states: a call is running and you are not in it, or you are. */
const bar: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.call.active' },

    // ── Not in a call ────────────────────────────────────────────────────────
    // Shown only when somebody else is in one, offering to join. *Starting* a call is the module
    // rail's job now — it was a floating pill here, which is what made the launcher inconsistency
    // visible in the first place.
    else: {
      type: '$if',
      props: {
        condition: { $: 'count(modules.call.ongoing)' },
        then: contentCentred('bottom', {
          type: 'Row',
          props: {
            // The same strip the in-call bar sits in — this is the bar that replaces it, in the
            // same place, and it keeps to the screen by the same rule. It used to position itself,
            // and made neither of the bar's corrections until the host published the content box.
            pointerEvents: 'auto',
            ...BAR_SURFACE,
            r: BAR_RADIUS,
            p: '200',
            gap: '300',
            ay: 'center',
            zIndex: 'sticky',
          },
          /*
            One row per call, because a space can now hold several.

            This was a single line — "3 in a call · Join" — which was exactly right while a space had
            one call and is a lie the moment it has two: the count summed strangers into one number
            and the button joined whichever the derived id happened to name. A person arriving at a
            space with two conversations in it is choosing, not confirming, so the prompt has to show
            them the choice.

            It stays a bar rather than becoming a modal: it is ambient, it must not take the screen
            away from what somebody came here to do, and one call — still the common case — reads as
            the same single line it always did.
          */
          children: [
            {
              type: '$each',
              props: { items: { $: 'modules.call.liveCalls' }, as: 'live' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', ay: 'center' },
                  children: [
                    {
                      type: 'AvatarStack',
                      // Faces rather than presence records — see the store. Handing an avatar
                      // something with no `image` or `hash` gets the generic person glyph, once per
                      // participant, which is what this used to be.
                      props: { avatars: { $: 'live.faces' }, size: 'sm', max: 4 },
                    },
                    {
                      type: 'we-text',
                      // One line, for the same reason the in-call readout keeps one — see
                      // `participants`. Truncated rather than wrapped: the bar is chrome, and a call
                      // with six named people in it must not push the button off the screen.
                      props: { variant: 'label', truncate: true, maxWidth: '18ch' },
                      children: [{ $: 'live.label' }],
                    },
                    {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        onClick: { $action: 'modules.call.joinCall', args: [{ $: 'live.id' }] },
                      },
                      children: ['Join'],
                    },
                  ],
                },
              ],
            },
            {
              // Starting a second call beside one already running is a real thing to want — a
              // breakout, a different subject — and the only control that used to exist for it
              // joined the call that was already there.
              type: 'we-button',
              props: {
                variant: 'ghost',
                size: 'sm',
                title: 'Start another call',
                onClick: { $action: 'modules.call.startCall' },
              },
              children: [{ type: 'we-icon', props: { name: 'plus' } }],
            },
          ],
        }),
      },
    },

    // ── In a call ────────────────────────────────────────────────────────────
    /*
      A column holding the bar, rather than the bar itself.

      The column is what lets `call-status` sit directly above the controls: a second positioned
      element would have to compute its own offset from this one's height, which depends on the
      controls in it and on whatever a theme does to a button, so it would be a number that is wrong
      the first time anything changes.

      Everything about *where* the column floats has moved out again, into `contentCentred` — the
      offset, the dock-aware centring, the clamp that keeps it on screen, the transitions. Those
      belong to the strip because all three of this module's floating pieces want them and the two
      smaller ones used to each guess separately. What is left here is what the column looks like,
      plus the one thing the strip cannot decide for it: that it takes clicks again, since the strip
      spans the whole edge and passes them through.

      `ax: 'center'` because a status row is narrower or wider than the bar and should be centred on
      it either way. The column paints nothing and takes no room beyond its children.
    */
    then: contentCentred('bottom', {
      type: 'Column',
      props: {
        pointerEvents: 'auto',
        // One step of the spacing scale, which is the nearest thing to the ~10px this wants and is
        // the only sort of value that follows a theme's density. Wide enough that the status row
        // reads as a separate object rather than as a second tier of the bar.
        gap: '300',
        ax: 'center',
      },
      children: [
        {
          /*
            Above the bar, not below it — the column runs upward from the bottom edge now.

            A status row is a sentence somebody is reading and the bar is a set of targets somebody
            is pressing, so the bar keeps the edge and anything reporting stacks away from it. Below
            it, a growing status panel would push the controls off the bottom of the window; above,
            it grows into empty space.

            Renders nothing at all when nobody has contributed, so the bar keeps its own shape.
          */
          type: '$slot',
          props: { anchor: CALL_STATUS_ANCHOR },
        },
        {
          type: 'Row',
          props: {
            ...BAR_SURFACE,
            r: BAR_RADIUS,
            p: '200',
            gap: '200',
            ay: 'center',
          },
          children: [
            returnToCall,
            mediaToggle({
              on: 'microphone',
              off: 'microphone-slash',
              enabled: 'modules.call.media.audioEnabled',
              action: 'modules.call.toggleAudio',
              tip: { on: 'Mute', off: 'Unmute' },
            }),
            mediaToggle({
              on: 'video-camera',
              off: 'video-camera-slash',
              enabled: 'modules.call.media.videoEnabled',
              action: 'modules.call.toggleVideo',
              tip: { on: 'Turn camera off', off: 'Turn camera on' },
            }),
            // From here to the divider, everything but the contributed controls folds into `moreMenu`
            // when the row is compact — see `COMPACT`. The glyph is explained on `SCREEN_SHARE`.
            whenRoomy(mediaToggle(SCREEN_SHARE)),
            {
              // Where other modules put their call controls — see `anchors` below. The marker is replaced
              // by whatever is contributed, or by nothing at all, so the bar has no gap when no module
              // has joined it and this module never learns which ones did.
              type: '$slot',
              props: { anchor: CALL_CONTROLS_ANCHOR },
            },
            /*
              Contributed controls stay in the row at every width, and the fold sits after them.

              This module cannot put another module's chrome in its menu — it does not know what
              that chrome is, and a contributed square may be the loudest thing in the bar (a red
              "recording" button, say) precisely because it has to be seen. So the menu holds only
              what this module owns, and sits where the folded buttons were, so the row reads the
              same in either state: your devices, then the rest.
            */
            whenCompact(moreMenu),
            /*
          Show/hide sits with the devices, not with the call.

          It was on the right, beside the participant readout, on the grounds that it is about the
          video — but so is the camera button, and what actually separates the two groups is *whose*
          they are. Everything left of the divider is something you do to your own machine: your
          microphone, your camera, your screen, your transcript, and whether you are looking at the
          video. Everything right of it is the call itself — who is in it, and how much room it has.
        */
            /*
              Development only, and absent rather than inert in a production build — see
              `devPeerControls`. Placed with the things you do to your own machine rather than with
              the call itself, which is what the divider below separates: how many fake participants
              you are looking at is a property of your session, not of the call.

              Two gates, doing different jobs. `devPeersAvailable` is the build, so a shipped app
              carries no node at all. The `$if` is the `we.devTools` switch, which is live — a
              developer looking at what a user sees loses these on the press rather than on the next
              reload, and gets them back the same way.
            */
            ...(devPeersAvailable
              ? [
                  {
                    type: '$if',
                    props: { condition: { $: 'sessionStore.devTools' }, then: devPeerControls },
                  },
                ]
              : []),
            /*
              Solo — the spotlight with the stage to itself.

              Only while something is focused, which is also the affordance: giving somebody the
              stage reveals the option to give them all of it. A toggle rather than a third click on
              the tile, because a three-state cycle on one gesture cannot say which state it is in —
              see `solo` in the store.
            */
            whenRoomy({
              type: '$if',
              props: { condition: { $: 'modules.call.focusedId' }, then: mediaToggle(SOLO) },
            }),
            whenRoomy(mediaToggle(STAGE)),
            // Two thirds of a control's height, so it reads as a separator between groups rather than as
            // a rule drawn down the whole bar. It moved with the buttons: at 20px against `sm` it was
            // that already, and left alone against `md` it would have been half.
            { type: 'we-divider', props: { orientation: 'vertical', height: '26px' } },
            participants,
            {
              type: 'we-tooltip',
              props: { title: 'Leave the call', placement: 'bottom' },
              children: [
                {
                  // Square like the toggles at the other end, being an icon and nothing else.
                  type: 'we-button',
                  props: { square: true, variant: 'danger', onClick: { $action: 'modules.call.leave' } },
                  children: [{ type: 'we-icon', props: { name: 'phone-x' } }],
                },
              ],
            },
          ],
        },
      ],
    }),
  },
};

/**
 * The call's audio, attached to the document independently of anything you can see.
 *
 * ## Why this exists at all
 *
 * Because sound and picture were one decision, and the picture is conditional in three separate
 * places. A tile renders `we-video` only while that peer `hasPicture`; the stage renders tiles only
 * while it is open; and the host unmounts a dock whose edge is null — deliberately, so a stage
 * nobody is watching stops decoding video. Each of those is right on its own terms, and each one
 * silenced the call, because a `<video>` element was the only thing a remote stream was ever
 * attached to. Turn your camera off and nobody could hear you. Put the video away and the call went
 * quiet — which is a valid thing to want and was the fastest way to break it.
 *
 * A call is audio first. So the audio hangs off `active` and nothing else: it is mounted from the
 * moment you are in a call until you leave, at the same anchor as the control bar, whatever the
 * stage is doing. One `we-audio` per remote participant, playing that peer's stream.
 *
 * ## Why not one element for everyone
 *
 * A `MediaStream` per peer is what the mesh produces — `ontrack` adds each arriving track to that
 * peer's own stream — and mixing them into one would mean a `WebAudio` graph this module has no
 * other use for. Per-peer also means a peer leaving takes their element with them, which is exactly
 * what `$each` over the tiles already expresses.
 *
 * Remote tiles only: your own tile is your own microphone, and playing that back is a feedback loop.
 *
 * Nothing is visible. `we-audio` without `controls` draws nothing, and an audio element plays
 * whether or not anything is painted for it — visibility and playback are unrelated for media
 * elements, which is the whole property being relied on here.
 */
const audioSink: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.call.active' },
    then: {
      type: '$each',
      props: {
        items: { $: 'filter(modules.call.tiles, { isSelf: false })' },
        as: 'tile',
      },
      children: [{ type: 'we-audio', props: { stream: { $: 'tile.stream' }, autoplay: true } }],
    },
  },
};

/** Whatever went wrong, said out loud. A call that silently fails to start is indistinguishable from
 *  one nobody has joined. */
const problem: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.call.problem' },
    /*
      The end the call bar is not at — which is the top now that the bar has taken the bottom.

      Both were pinned to the same offset once, so the alert opened underneath the controls —
      mostly hidden, and with its dismiss button unreachable, which is a poor showing for the one
      piece of UI whose entire job is to be read. It has swapped ends with the bar rather than
      gaining a rule: "the other end from the controls" is the whole of the requirement.

      In the same kind of strip as the bar, so it clears a panel docked along its edge, centres on
      the content, and stays on screen when the content is narrower than it. It had none of the
      three once, on the reasoning that the bar no longer moves so nor does this — true of the bar
      and irrelevant to the window, which is what both were actually pinned to.
    */
    then: contentCentred('top', {
      type: 'Row',
      props: { pointerEvents: 'auto', maxWidth: '420px' },
      children: [
        {
          type: 'we-alert',
          props: { variant: 'warning', dismissible: true, onClose: { $action: 'modules.call.dismissProblem' } },
          children: [{ $: 'modules.call.problem' }],
        },
      ],
    }),
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
    onClick: { $action: 'modules.call.joinAnchoredCall', args: [{ $: 'node.id' }] },
  },
  children: [{ type: 'we-icon', props: { name: 'phone-call' } }],
};

/** A bare "start a call here" trigger, for templates that want one in their own chrome. */
const startCallButton: SchemaNode = {
  type: 'we-button',
  props: { variant: 'ghost', size: 'sm', onClick: { $action: 'modules.call.startCall' } },
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
  anchors: [CALL_CONTROLS_ANCHOR, CALL_STATUS_ANCHOR],

  /*
    Drawn by the host's module rail.

    `activeWhen` used to be omitted, on the grounds that this starts a call rather than toggling a
    panel and the call bar already says one is running — a highlighted rail tab would be saying it
    twice. Two things were wrong with that.

    The rail is the surface people scan for "where am I", and it is the only chrome that is always
    there: the bar is a strip at the bottom centre, this is a column at the right edge, and they are
    not read at the same moment. Being in a call is the most stateful thing this app does, and it was
    the one row of that rail that could never show it.

    Worse, a launcher with no state is a launcher whose click has to mean one thing, and this one's
    meant three — dead in the space call, and a silent teardown of any other. `goToCall` is the
    reading that survives every state, so the button lights up and stays useful rather than becoming
    an unlabelled hazard. `activeLabel` is what stops the tooltip describing the act it no longer
    performs; see the store.
  */
  launcher: {
    icon: 'phone-call',
    label: 'Start call',
    activeLabel: 'Go to the call',
    action: 'goToCall',
    activeWhen: 'active',
    availableWhen: 'canCall',
  },

  /*
    A call in progress keeps its chrome wherever you go.

    Module chrome is otherwise gated on the space you are looking at, which is right for chrome that
    is *about* that space and wrong for this: a call outlives navigating away from where it started,
    so in a space that has not enabled calls the bar vanished while the call carried on — hang-up
    button included. Nothing was broken underneath, which is what made it read as a crash.

    `active` is false the moment the call ends, which is the condition this has to satisfy: a key
    that stayed true would make the bar permanent.
  */
  holdsWhen: 'modules.call.active',

  slots: [
    { anchor: 'dock-bottom', node: bar, order: 100 },
    { anchor: 'dock-bottom', node: problem, order: 80 },
    /*
      The audio, at the same anchor as the bar rather than in the dock.

      Chrome, not a panel: it renders nothing and takes no room, and it has to outlive every state
      the stage can be in — including not existing. A slot contribution is mounted for as long as the
      shell is, which is the property the sound needs and the dock deliberately does not have.
    */
    { anchor: 'dock-bottom', node: audioSink, order: 60 },
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
  docks: [
    { edge: 'dockEdge', size: 'dockSize', float: 'dockFloat', aspect: 'dockAspect', close: 'closeStage', node: stage },
  ],

  createStore: (deps: ModuleStoreDeps) => createCallStore(deps),
});
