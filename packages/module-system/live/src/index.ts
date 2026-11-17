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
 * The call module. Sharing a pointer and taking the wheel are lines in the call bar's More menu, and
 * they get there through the `call-menu` anchor the call module opened — so neither module knows the
 * other, and a third can join the same menu. Which call is running
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
import {
  cursorMenuItem,
  cursorToggle,
  driverStrip,
  fakeCursorControls,
  problemStrip,
  wheelButton,
  wheelMenuItem,
} from './Live.schema';
import { createLiveStore } from './store';

export { CURSOR_TTL_MS, cursorIntervalMs, LIVE_PROTOCOL_VERSION, parseLiveMessage, VIEW_REPEAT_MS } from './protocol';
export {
  cursorMenuItem,
  cursorToggle,
  driverStrip,
  fakeCursorControls,
  problemStrip,
  wheelButton,
  wheelMenuItem,
} from './Live.schema';
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
      cursorToggle: {
        node: cursorToggle,
        label: 'Live cursors',
        description: 'Shares your pointer and shows everyone else’s, or stops.',
      },
      wheelButton: {
        node: wheelButton,
        label: 'Take the wheel',
        description: 'Leads, so anyone who follows sees your screen.',
      },
      driverStrip: {
        node: driverStrip,
        label: 'Who is driving',
        description: 'Says who is leading, and lets you follow or stop.',
      },
      // Development only, and absent rather than inert in a production bundle — see `devCursors.ts`.
      ...(devCursorsAvailable ? { fakeCursorControls } : {}),
    },

    /**
     * The default homes: the two anchors the call module opened.
     *
     * Contributing to another module's anchor is how capabilities are supposed to meet — neither names
     * the other, a third can join the same bar, and a space with calls switched off simply has nothing
     * matched here. Following a driver is also on the rail (below), for somebody who is not in the call.
     */
    slots: [
      /*
        Lines in the bar's More menu rather than squares in its row — `call-menu`, not
        `call-controls`. Sharing a pointer and taking the wheel are set-and-leave controls, which is
        the split the call module draws between the two anchors, and a menu can only hold what a
        menu holds: `we-menu-item`s, contributed as such rather than asking the call to translate a
        button it cannot read.
      */
      { anchor: 'call-menu', node: cursorMenuItem, order: 20 },
      { anchor: 'call-menu', node: wheelMenuItem, order: 21 },
      { anchor: 'call-status', node: driverStrip, order: 10 },
      { anchor: 'call-status', node: problemStrip, order: 11 },
      /*
        The development region, not the control region.

        A harness triple belongs beside the other harness triple and after everything a shipped build
        has, so the bar a user gets and the bar a developer gets differ by one trailing group rather
        than by a control wedged into the middle of the real ones. Contributions land at a single
        point, so being in the same region as the other triple is the only way to be next to it.

        The anchor is a literal, like every other anchor named here: naming the region is not the same
        as depending on whoever provides it, and a region nobody provides renders nothing.
      */
      ...(devCursorsAvailable ? [{ anchor: 'call-dev', node: fakeCursorControls, order: 20 }] : []),
    ],

    /**
     * The rail keeps one live button: following whoever is driving.
     *
     * Sharing your pointer and taking the wheel were rail launchers too, and so showed twice on screen
     * during a call — on the rail and in the bar's More menu. They have one home now, the menu (see the
     * `call-menu` slots above), which also means they are reached only while a call is running.
     */
    launchers: [
      /*
        Somebody else is driving, so what is on offer is following them.

        This is the entry point the call bar's status strip provides during a call, and it is on the
        rail as well because a driver can be followed by somebody who is not in the call — the bar is
        not there unless they are.
      */
      {
        key: 'follow',
        icon: 'eye',
        label: 'Follow the driver',
        activeLabel: 'Stop following',
        action: 'toggleFollow',
        activeWhen: 'following',
        availableWhen: 'canFollow',
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
