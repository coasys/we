/**
 * Live — other people's cursors on the page, and one person driving.
 *
 * ## The fourth module, and what it tests
 *
 * Notes proved a module can own durable entities; the globe proved one can carry a heavyweight
 * framework component; the call proved one can reach the ephemeral port. This one owns **no data at
 * all**. Everything it deals in is worthless a second later, which makes it the first test of a
 * capability whose entire output is transient — and of the `view` kernel, which is the host's answer to
 * "where is this person looking".
 *
 * ## Two features, one substrate
 *
 * Cursors and a driver's seat look like separate things and are the same thing at two rates. Both are
 * "what is this person's screen doing", both ride one channel, both expire through presence rather than
 * through a message, and both are drawn by the host because only the host can turn a frame into
 * pixels. Building either alone would have produced most of the other.
 *
 * ## What it never names
 *
 * The call module. A cursor toggle belongs beside mute and camera, and it gets there through the
 * `call-controls` anchor the call module opened — so neither module knows the other, a third can join
 * the same bar, and turning calls off leaves this one working everywhere else. Which call is running
 * and who is in it arrive through presence, as they do for transcription.
 *
 * ## Fragments only
 *
 * No `frameworks`, no components. The cursor itself is a Lit primitive, because an arrow and a name
 * chip are presentation every renderer should get once; everything this module adds on top of it is
 * data.
 */
import { defineModule, type ModuleDefinition, type ModuleHost } from '@we/module-shared';

import { devCursorsAvailable } from './devCursors';
import { cursorToggle, driverStrip, fakeCursorControls, problemStrip, wheelButton } from './Live.schema';
import { createLiveStore } from './store';

export { CURSOR_TTL_MS, cursorIntervalMs, LIVE_PROTOCOL_VERSION, parseLiveMessage, VIEW_REPEAT_MS } from './protocol';
export { cursorToggle, driverStrip, fakeCursorControls, problemStrip, wheelButton } from './Live.schema';
export { createLiveStore, type LiveFace, type LiveStore } from './store';

export const liveModule: ModuleDefinition = defineModule({
  manifest: {
    id: 'live',
    name: 'Live presence',
    description: 'See each other’s cursors, and follow one person’s screen.',
    icon: 'cursor-click',
    /*
      Three kernels and no permissions.

      `presence` for who is here and who is driving, `ephemeral` for the channel, `view` for the screen.
      Nothing is stored, nothing is captured, and no network is reached that the space was not already
      using — which is why the install screen has nothing alarming to show, and why it should not.
    */
    requires: { kernels: ['presence', 'ephemeral', 'view'] },
  },

  contributes: {
    /**
     * Named parts, so an interface can put these where it wants rather than taking the call bar's
     * arrangement. A workshop template with its own chrome places `cursorToggle` beside its own
     * controls; the anchors below are the default for a deployment that arranges nothing.
     */
    parts: {
      cursorToggle,
      wheelButton,
      driverStrip,
      // Development only, and absent rather than inert in a production bundle — see `devCursors.ts`.
      ...(devCursorsAvailable ? { fakeCursorControls } : {}),
    },

    /**
     * The default homes: the two anchors the call module opened.
     *
     * Contributing to another module's anchor is how capabilities are supposed to meet — neither names
     * the other, a third can join the same bar, and a space with calls switched off simply has nothing
     * matched here. The rail launcher below is what makes the module reachable when no call is running.
     */
    slots: [
      { anchor: 'call-controls', node: cursorToggle, order: 20 },
      { anchor: 'call-controls', node: wheelButton, order: 21 },
      { anchor: 'call-status', node: driverStrip, order: 10 },
      { anchor: 'call-status', node: problemStrip, order: 11 },
      ...(devCursorsAvailable ? [{ anchor: 'call-controls', node: fakeCursorControls, order: 22 }] : []),
    ],

    /**
     * A rail button, because cursors are not only for calls.
     *
     * Two people reading the same board want to point at things whether or not anybody is talking, and
     * the call bar does not exist unless a call does. `availableWhen` takes it off the rail in a
     * personal space, which has nobody to be live to.
     */
    launchers: [
      {
        key: 'cursors',
        icon: 'cursor-click',
        label: 'Share your pointer',
        activeLabel: 'Stop sharing your pointer',
        action: 'toggleCursors',
        activeWhen: 'cursorsOn',
        availableWhen: 'canShareCursors',
      },
      /*
        The wheel, on the rail as well as in the call bar.

        Contributed to `call-controls` too, which is where it belongs while a call is running — but the
        bar only exists while one is, so without this the feature is unreachable unless somebody is
        talking. That is the same argument the cursor launcher above carries, and it applies harder
        here: "look at what I am looking at" is most useful when explaining something, which is not the
        same thing as being in a call.

        `toggleWheel` rather than two entries, for the reason the button gives: only the store can ask
        which state it is in at the moment of the press.
      */
      {
        key: 'wheel',
        icon: 'signpost',
        label: 'Take the wheel',
        activeLabel: 'Give up the wheel',
        action: 'toggleWheel',
        activeWhen: 'driving',
        availableWhen: 'canDrive',
      },
    ],

    /**
     * The shapes this module publishes on presence, declared so the next module to cooperate with it
     * reads them from a declaration rather than from these tests.
     *
     * All three are *participation*, which is why they are activities rather than a channel of their
     * own: they expire on a TTL, so a driver whose laptop closes releases every follower without
     * anybody sending anything.
     */
    activities: {
      live: { cursors: 'boolean' },
      driving: { since: 'number' },
      following: { id: 'string' },
    },

    settings: [
      {
        key: 'cursors',
        label: 'Live cursors',
        description: 'Let people here see each other’s pointers.',
        type: 'boolean',
        default: true,
        /*
          `restrict`, like recording — the one resolution where a lower level cannot grant what a
          higher one refused, and a higher one cannot overrule a refusal below it. A decision about
          broadcasting where your pointer is travels in one direction only: a community that has
          switched cursors off is not overridable by a member, and a member who wants nothing to do
          with them is not overridable by the community.
        */
        resolution: 'restrict',
        levels: ['deployment', 'space', 'agent-in-space'],
      },
      {
        key: 'driving',
        label: 'Driving',
        description: 'Let one person take the wheel, so others can follow their screen.',
        type: 'boolean',
        default: true,
        // `override`, not `restrict`: following is opted into per person at the moment it happens, so
        // there is nothing here a member needs a veto over that the Stop button does not already give.
        levels: ['deployment', 'space'],
      },
    ],
  },

  createStore: createLiveStore,
});

/** The factory the seed's generated registry calls. No host components — this module ships none. */
export function createModule(_host: ModuleHost): ModuleDefinition {
  return liveModule;
}
