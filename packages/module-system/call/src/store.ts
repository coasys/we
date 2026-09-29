/**
 * The call store — what a template can read and drive.
 *
 * Written against `ModuleStoreDeps` alone: `signal` and `effect` for reactivity, `dataset`/`selfId`
 * for scope, and under `deps.kernels` exactly the five the manifest asks for — `ephemeral` for
 * transport, `presence` for membership, `records` for the call's record, `media` for this agent's
 * devices, `peerConnection` for the mesh. It imports no framework and no backend, which is what lets
 * the whole module ship as schema fragments.
 *
 * ## What a template may reach
 *
 * Members are private to this module's own chrome unless marked with `deps.state` or `deps.action`
 * at the bottom of this file. The marked set is the call's *domain* — who is in it, which record it
 * is, join/leave/mute — and every key a space template already names as `modules.call.<key>`. The
 * stage's plumbing (`stageBid`, the track strings, the per-tile style lookups) is not marked: it is
 * read by the panel declaration and by this module's own fragments, which render at chrome tier and
 * see everything.
 *
 * ## The shape of the thing
 *
 * Three collaborators, each ignorant of the others' failure modes:
 *
 * - **presence** owns *who is in the call* (an activity, expiring on TTL)
 * - **the mesh** owns *connections to them* (reconciled against that roster)
 * - **the media controller** owns *this agent's devices*
 *
 * This file is the only place they meet, and the meeting is deliberately one-directional: presence
 * drives the mesh, and media drives what the mesh sends. Nothing flows back — the mesh never tells
 * presence who is in the call, because a connection failing is not the same as a peer leaving.
 */
import type { DockAspect, MediaDevice, MediaSettings, PanelBid } from '@we/module-shared';
import type { Focus, ModuleStoreDeps, Peer } from '@we/module-shared';
import type { EphemeralScope } from '@we/module-shared';
import { activitiesOfType } from '@we/module-shared';
import { planEphemeral } from '@we/module-shared';

import { type DeviceKind, readChosenDevice, writeChosenDevice } from './devices';
import { devPeers, devPeersAvailable, readDevPeerCount, stopDevPeers, writeDevPeerCount } from './devPeers';
import { parseIceServers } from './iceServers';
import { createMediaController, type MediaController } from './media';
import { type CallMesh, createCallMesh, DEFAULT_ICE_SERVERS, type RecoveryRung } from './mesh';
import { CALL_KIND, CALL_PREDICATE, CALL_PROTOCOL_VERSION, recordCallId } from './protocol';
import { solveStrip } from './strip';

/**
 * One participant, flattened for a template.
 *
 * Flattened rather than nested so a fragment can reach everything with a plain `$tile.stream` —
 * the same reason `PresentAgent` flattens `tone` onto the peer.
 */
export interface CallTile {
  id: string;
  did: string;
  /** `null` until that peer's media arrives, which is normal for the first second or two. */
  stream: MediaStream | null;
  isSelf: boolean;
}
// No `name` or `avatar` here, and the omission is deliberate rather than an oversight. Both existed,
// both were always undefined, and both were an open invitation to the one mistake this type is
// shaped to prevent: a profile arriving is not a reason to remount somebody's video. They are looked
// up by id instead — see `tileFaces`.

/**
 * A participant's *volatile* state, deliberately kept out of {@link CallTile}.
 *
 * This split is not tidiness, it is the fix for a visible bug. `$each` renders through Solid's
 * `<For>`, which is keyed by reference, so any change to a tile object remounts that row — and a
 * remounted row builds a new `<video>`, which drops and re-attaches `srcObject`. With mute state on
 * the tile, muting your microphone blanked your own video.
 *
 * So the tile carries only what identifies a participant and their stream, and changes rarely. Their
 * flags live here and a fragment reaches them with `find()` over `modules.call.tileStates` — which
 * resolves inside the renderer's prop memo, so it stays reactive while the row itself never remounts.
 */
export interface CallTileState {
  id: string;
  /** Render `contain` rather than `cover` — a cropped desktop is unreadable. From the roster. */
  isScreen: boolean;
  audioEnabled: boolean;
  videoEnabled: boolean;
  /** `undefined` for the self tile, which has no connection to itself. */
  connection?: RTCPeerConnectionState;
  /** This tile is the one the stage is giving most of its room to. */
  focused: boolean;
  /**
   * There is a picture to show right now: a live video track, *and* a sender who says it is on.
   *
   * What decides video-or-avatar, and it has to be this rather than "is there a stream" because the
   * mesh creates a peer's `MediaStream` when the peer appears in the roster, not when media starts
   * flowing. That object is non-null and empty for the whole negotiation, so a check for its
   * existence renders a `<video>` over nothing and paints a black rectangle — the blank tile that
   * outlasted two attempts to explain it, because every explanation assumed the stream was missing
   * when it was present and empty.
   *
   * The roster half matters too: a muted camera keeps its track live and simply stops producing
   * frames, so the track alone cannot tell "off" from "on but silent".
   */
  hasPicture: boolean;
  /**
   * A picture is expected and has not arrived — the honest "wait, this is working" state.
   *
   * Expected, not merely absent: a peer who has turned their camera off is not connecting, and
   * spinning at them forever would be a lie about a state that is never going to change.
   */
  connecting: boolean;
  /**
   * Something is being done about it right now — the mesh is on a rung of its recovery ladder.
   *
   * Distinct from {@link connecting}, which only says a picture is expected. The difference is the
   * one a person actually wants: a spinner that has been turning for thirty seconds says nothing
   * about whether anything is happening, and "Reconnecting…" says the app has noticed and is not
   * waiting for you to. It is also what stops the reconnect button reading as the only hope.
   */
  retrying: boolean;
  /** How many repairs this pair has had, so a tile can stop promising after several. */
  attempts: number;
  /**
   * How this peer's media is reaching us — `host` on a LAN, `srflx` through NAT, `relay` through
   * TURN — or `''` before the connection settles. Diagnostic; shown on the connection badge.
   */
  transport: string;
  /** The connection gave up. Not something waiting will fix, so it must not read as progress. */
  failed: boolean;
}

/**
 * The stage's own padding and the gap between tiles, in pixels — `300` on the space scale.
 *
 * Named because two places have to agree about them and they are far apart: the stage node in
 * `index.ts` sets them as design tokens, and the aspect `stageBid` carries subtracts them so "fit to
 * content" solves for the right height. They drifted apart once already — the aspect ignored them
 * entirely, and the fit came out short by exactly their sum.
 */
export const STAGE_PADDING_PX = 12;
export const STAGE_GAP_PX = 12;

/** The tile aspect the whole stage is laid out from. */
const TILE_ASPECT = 16 / 9;

/**
 * How much of the bottom of the window the call bar occupies, for panels to keep clear of.
 *
 * `CALL_BAR_INSET` (10px) plus a row of `md` controls (40px) in a surface padded by `200` a side
 * (8px twice), plus a little air so a panel snapped above it does not touch. Derived rather than
 * chosen, like `CHROME_RAIL_WIDTH`: change the bar's size or padding and this has to follow, or
 * panels start landing underneath it again.
 *
 * The bottom, since the bar moved there. Lived in the shell as `TOP_CHROME_PX` until the bar
 * stopped being the only thing up there; see `chromeReserve` below.
 */
export const CALL_BAR_RESERVE_PX = 74;

/**
 * How wide the bar gets, at its widest — what lets the host tell "the module rail has slid left far
 * enough to hit the call controls" from "the rail is nowhere near them".
 *
 * Measured at about 440 with the standard controls and one contributed button, plus room for the
 * participant roster to grow. The bar is content-sized, so this cannot be exact — and the two errors
 * are not symmetrical: too wide moves the rail slightly earlier than it had to, too narrow puts the
 * rail across the controls. So it rounds up.
 */
export const CALL_BAR_WIDTH_PX = 480;

/*
  No `CallStoreDeps` any more. The store used to extend the deps bag with a private
  `createPeerConnection` because there was nowhere else to put a thing the host had and the module
  needed — which `kernels.ts` names as the first sign a kernel was missing. It is `deps.kernels
  .peerConnection` now: declared in the manifest, overridable in a test for the same reason it was
  here, and available to the next module that wants one without inventing the same extension.
*/

/**
 * Whether a stream is actually carrying a picture, rather than merely existing.
 *
 * The distinction the tiles turned on and nobody had drawn. `mesh.ts` builds a peer's `MediaStream`
 * at the moment the peer joins the roster and adds tracks to it later, as `ontrack` fires — so the
 * object is non-null and empty for the whole of negotiation, and on a slow transport that is many
 * seconds. Truthiness of the stream answers "do I know about this person", never "is there anything
 * to watch".
 */
/**
 * Connection states that mean "not on its way" — a pair that had one and lost it, or never will.
 *
 * `new` and `connecting` are absent on purpose: those are the window this whole `connecting` flag
 * exists to cover. So is an absent state, which is a peer the mesh has not negotiated with yet.
 */
const GONE = new Set<string>(['disconnected', 'failed', 'closed']);

/**
 * Whether this stream has a video track that is actually delivering frames.
 *
 * `readyState` alone was the bug behind every frozen tile. It answers "has this track been stopped",
 * which for a **remote** track is almost never: it stays `live` for as long as the connection object
 * exists, whatever the far end is doing. What says "nothing is arriving" is `muted`, which the
 * browser sets when RTP stops — a peer leaving, crashing, or losing their network — and clears again
 * if it comes back.
 *
 * So a departed peer read as having a picture, the `<video>` kept its `srcObject`, and the browser
 * went on painting the last frame it had decoded. Both halves are needed: `muted` alone would miss a
 * track that was genuinely stopped, and `readyState` alone misses every way a call actually ends.
 *
 * The mesh re-emits its streams on `mute` and `unmute` so this is re-asked when the answer changes —
 * see `pc.ontrack` there.
 */
function hasLiveVideo(stream: MediaStream | null): boolean {
  return !!stream?.getVideoTracks().some((track) => track.readyState === 'live' && !track.muted);
}

export function createCallStore(deps: ModuleStoreDeps) {
  const {
    signal,
    effect,
    dataset,
    datasetUri,
    selfId,
    identities,
    datasets,
    onDispose,
    callOnScreen,
    settings,
    state,
    action,
  } = deps;
  /*
    Only the kernels the manifest names are on the bag, and every one is optional at the type level:
    registration refuses a host that implements none of them, but a module must still degrade rather
    than throw, so each is checked where it is reached. `media` is renamed on the way in because
    `media` below is the signal carrying this agent's mute/camera/share state, which a template reads.
  */
  const { presence, ephemeral, records, media: mediaKernel, peerConnection } = deps.kernels;

  /**
   * The transport scope this call holds, so leaving can give it back.
   *
   * `EphemeralScope` is refcounted, and every join acquired one and never disposed it. Ten joins
   * left ten refs outstanding, so the backend's signal handler for that perspective was never
   * removed for the life of the app. `PresenceStore` has always done this correctly; this is the
   * same discipline.
   */
  let scopeHandle: { dispose(): void } | null = null;

  /**
   * An agent id, joined to whatever the host knows about them, in the shape an avatar wants.
   *
   * Computed at the point of display rather than stored, and that is the whole trick: a profile that
   * arrives late must change the picture without changing the roster, because changing the roster
   * remounts video elements. Reading `identities.get` inside a derived value is what makes the
   * picture appear on its own when the fetch lands.
   *
   * `hash` is always supplied, never as a fallback for a missing image: it seeds a generated avatar
   * that is stable per agent, so somebody with no profile picture is still visually distinct from
   * everybody else with no profile picture — and stays the same person between renders. `image` wins
   * where a real one exists.
   */
  function faceOf(agentId: string): { image?: string; hash: string; name?: string } {
    const profile = identities?.get(agentId);
    // Asking is idempotent and the host deduplicates in-flight requests, so this is safe on a hot
    // path — and it is the only thing that ever triggers a fetch for a peer nobody has looked up.
    if (!profile) identities?.fetch(agentId);
    return { image: profile?.avatar, hash: agentId, name: profile?.name };
  }

  const [callId, setCallId] = signal<string | null>(null);
  const [tiles, setTiles] = signal<CallTile[]>([]);
  const [tileStates, setTileStates] = signal<CallTileState[]>([]);
  /**
   * Whether the stage is on screen. False between calls, and set by `join` — see there.
   *
   * This is the one panel whose openness the module owns rather than the host: whether the stage is
   * up is a fact about the call, and the panel declaration names this key as its `open`. The initial
   * value is the state of a module that is not in a call, which is the only state this is ever read
   * in before one starts — a closed panel is simply not placed.
   */
  const [visible, setVisible] = signal(false);
  /**
   * Whose video the stage is giving most of its room to, or `null` for an even grid.
   *
   * A signal of its own rather than a field on {@link CallTile}, for the reason the tile cache
   * exists at all: `$each` renders through a reference-keyed `<For>`, so writing focus onto a tile
   * object would remount that row and drop its `srcObject`. Clicking a participant to focus them
   * would have blanked the participant you clicked — the mute bug again, with a worse trigger.
   */
  const [focusedId, setFocusedId] = signal<string | null>(null);
  /**
   * Whether the *user* chose the current focus, as opposed to a screen share claiming it.
   *
   * Without this, auto-focus and the user fight: someone starts sharing, you focus a person
   * instead, and the next roster heartbeat drags you back. A screen share is a strong hint about
   * what matters, but only until somebody says otherwise.
   */
  let focusIsManual = false;
  /** The peers already sharing, so a share that has been running for ten minutes cannot re-claim focus. */
  let sharingPeers = new Set<string>();
  const [media, setMedia] = signal<MediaSettings>({
    audioEnabled: true,
    videoEnabled: true,
    screenShareEnabled: false,
  });
  /** Surfaced rather than logged: "the call cannot start here" is something the user must see. */
  const [problem, setProblem] = signal<string | null>(null);

  /**
   * Named, because it is the one problem that can resolve itself.
   *
   * Every other message here describes something structural — no space, no transport — that stays
   * true until the user does something elsewhere. This one is about a permission, and a permission
   * can be granted a moment later; leaving it on screen after the camera starts working is the
   * app telling the user something it can plainly see is no longer so.
   */
  /*
    Worded for every host, which the first version was not.

    "Check this site's permissions in your browser" is good advice in `we-web` and nonsense in
    Electron and Tauri, where there is no browser and no site — so on two of the three hosts it told
    the user to do something impossible. It also named only one of the two common causes: a device
    another application already has open fails the same way, and is at least as frequent.
  */
  const MEDIA_BLOCKED =
    'WE could not reach your camera or microphone. Check that WE has permission to use them, and that no other app has them open.';

  /**
   * The camera specifically, refused when the user asked for it.
   *
   * Separate from `MEDIA_BLOCKED` because the two clear on different conditions: this one is still
   * true while the microphone works perfectly well, so clearing it on "we have a stream" — which is
   * what the other one wants — would make it flash and vanish in exactly the case it exists for.
   */
  const CAMERA_BLOCKED =
    'WE could not turn your camera on. Check that WE has permission to use it, and that no other app has it open.';

  /**
   * The machine cannot capture a screen — as distinct from the user closing the picker.
   *
   * Worth its own message because the remedy is not "try again": on Linux this is usually a desktop
   * with no `org.freedesktop.portal.ScreenCast` interface, which is a missing portal backend rather
   * than anything the user did in WE.
   */
  const SCREEN_UNAVAILABLE =
    'WE could not capture a screen. This computer does not appear to offer screen sharing to apps.';

  /**
   * A device that was working has gone — unplugged, or taken by another application.
   *
   * Two messages rather than one, because the remedy differs and so does the urgency: a camera that
   * vanishes is visible to the person the moment they look at their own tile, where a microphone
   * that vanishes is invisible by construction. They are both worth saying, and the microphone is
   * the one that must be said.
   *
   * Phrased as what happened rather than as an instruction. "Reconnect it" is advice we cannot check
   * — the device may be gone on purpose, and the call carries on perfectly well without it.
   */
  const MIC_LOST =
    'Your microphone is no longer available — it may have been unplugged, or another app may have ' +
    'taken it. You are muted until you choose another one.';
  const CAMERA_LOST =
    'Your camera is no longer available — it may have been unplugged, or another app may have taken it.';
  /**
   * The microphone this agent is sending, as a signal rather than a read through to the controller.
   *
   * It has to be a signal because of *when* the stream appears. `join` sets `callId` and only then
   * builds the controller and awaits `getUserMedia`, so a consumer that derived the stream from
   * `callId` would be woken once — while there is still nothing to hear — and never again. The
   * transcriber sat on `no-audio` for the whole call, and its launcher never appeared.
   *
   * Written from `onStateChanged`, which fires when devices are acquired and on every mute since.
   * The controller returns the same `MediaStream` object each time, so those later writes dedupe on
   * `===` and consumers do not churn — which is what keeps muting from tearing down and rebuilding
   * the transcription pipeline. A muted track stays in the stream and simply goes silent.
   *
   * ## Published through the `media` kernel, not by a string key
   *
   * The definition used to say `audioSource: 'localAudio'` and the host read the member off this
   * store and lent it to every other module. That is `media.publish` now: this module says what it
   * is capturing, a module that wants to hear it reads `media.input()`, and neither names the other.
   * The publish happens in the setter so the two cannot disagree — every write to the signal is a
   * publish, and the dedupe above is what keeps a mute from re-announcing the same stream.
   */
  const [localAudio, writeLocalAudio] = signal<MediaStream | null>(null);
  function setLocalAudio(stream: MediaStream | null) {
    // The dedupe is load-bearing for the kernel as much as for the signal: `publish` replaces the
    // current publisher, so re-publishing the same stream on every mute would be noise, and
    // publishing `null` at teardown when nothing was ever published would take *another* module's
    // microphone off the air.
    if (stream === localAudio()) return;
    writeLocalAudio(stream);
    mediaKernel?.publish(stream);
  }

  /*
    What this machine has to capture with, and which of them this agent has picked.

    The list is the host's to answer and changes when hardware moves, so it is a signal refreshed
    from the kernel rather than a value read once. The choices are read from this machine's own
    storage at construction — see `devices.ts` for why they are not module settings — so a call
    joined after a reload uses the microphone the person chose last time without them touching
    anything.

    Held whether or not a call is running: choosing before you join is the case the settings screen
    exists for, and a chooser that only worked mid-call would be the wrong way round.
  */
  const [inputDevices, setInputDevices] = signal<MediaDevice[]>([]);
  /**
   * Whether the chooser is up.
   *
   * The module's own, not the host's, for the reason the stage's openness is: whether somebody is
   * picking a microphone is a fact about this module, and the two places that open it — the call
   * bar's menu and the settings screen — both reach it through the same action.
   */
  const [deviceSettingsOpen, setDeviceSettingsOpen] = signal(false);
  /**
   * Whether this machine has actually been asked, as opposed to not having answered yet.
   *
   * The difference decides what a chooser with nothing in it should say. Before a capture has ever
   * been allowed, a browser lists no devices at all — so "no microphone found on this computer" is
   * a claim about hardware made from a list that was never permitted to mention any. What is true
   * at that point is that we have not been allowed to look, and the useful thing on screen is the
   * button that fixes it. Only after asking and still finding nothing is the stronger sentence
   * honest.
   */
  const [devicesProbed, setDevicesProbed] = signal(false);
  const [audioDevice, setAudioDeviceId] = signal(readChosenDevice('audio'));
  const [videoDevice, setVideoDeviceId] = signal(readChosenDevice('video'));

  /**
   * One kind's devices as a picker's options, with "system default" at the top.
   *
   * Built here rather than in the schema for the reason `templateOverrideOptions` is: a schema can
   * map a store array into options and cannot *prepend* to one, and without that first entry there
   * is no way back to having no opinion — a picker you can only ever set is one you have to clear
   * by knowing where the storage is.
   *
   * An unnamed device is still offered. Labels are empty until capture has been allowed once, so
   * hiding them would make the list empty in exactly the state a first-run chooser is in; they are
   * numbered instead, which is enough to tell two apart and honest about knowing nothing else.
   */
  function optionsFor(kind: 'audioinput' | 'videoinput', noun: string) {
    const found = inputDevices().filter((device) => device.kind === kind);
    return [
      { label: `System default ${noun}`, value: '' },
      ...found.map((device, at) => ({
        label: device.label || `${noun.charAt(0).toUpperCase()}${noun.slice(1)} ${at + 1}`,
        value: device.deviceId,
      })),
    ];
  }

  /**
   * Ask the host what is plugged in.
   *
   * Answers with `[]` on a host that cannot say — a machine with no capture hardware, a browser that
   * has not been asked for permission — which is an ordinary state a chooser draws rather than an
   * error, so nothing here treats it as one. See the kernel.
   */
  async function refreshDevices(): Promise<void> {
    setInputDevices((await mediaKernel?.enumerateDevices()) ?? []);
  }

  /*
    Asked once at boot, so a chooser opened cold has something in it.

    Without this the list was populated only by joining a call or by opening the sheet from the call
    bar — so the settings page, which draws the same chooser inline and calls neither, rendered
    against an empty list and said "no microphone found" on a machine with several. The two surfaces
    disagreed about the hardware, which is a thing neither of them decides.

    A browser that has been granted capture before remembers it, so on the ordinary machine this
    returns real devices with real names straight away. One that has not returns little or nothing,
    which is a state the chooser has to draw anyway — see `devicesProbed`.
  */
  void refreshDevices();

  /*
    The list follows the hardware.

    Without this the choices go stale at exactly the moment they are read: somebody reaches for a
    headset *because* they are about to use it, and a picker still listing what was there a minute
    ago is a picker that lies when it matters. The unsubscribe is a no-op where the host cannot
    watch, so this is the same shape on every platform.
  */
  const stopWatchingDevices = mediaKernel?.onDevicesChanged(() => void refreshDevices());
  onDispose?.(() => stopWatchingDevices?.());

  let mesh: CallMesh | null = null;
  let controller: MediaController | null = null;
  let remoteStreams = new Map<string, MediaStream>();
  let peerStates = new Map<string, RTCPeerConnectionState>();
  /**
   * Which peers the mesh is currently repairing, and how many times it has tried.
   *
   * Held here rather than read off the mesh because it is *display* state with a life of its own: a
   * repair is an event, and a tile has to keep saying "Reconnecting…" for a moment after it rather
   * than flashing once per attempt. Cleared when the connection reaches `connected`, which is the
   * only thing that makes the word untrue.
   */
  const recovering = new Map<string, { rung: RecoveryRung; attempts: number }>();
  /**
   * How each peer's media is actually reaching us — `host`, `srflx`, `relay`.
   *
   * Refreshed when a connection settles rather than polled. The one fact that distinguishes "this
   * pair needs a relay" from "this pair's handshake was lost", which are otherwise the same spinner.
   */
  const transports = new Map<string, string>();

  /** Signalling channels whose first-send cost has already been paid — see the note in `join`. */
  const warmed = new WeakSet<object>();

  /**
   * The ICE servers this call should use, resolved where the agent is standing.
   *
   * Read at join rather than held, because settings resolve per space and a call started in one
   * community should use that community's relay. An unparseable value answers with the module's
   * defaults, which is the behaviour of an empty field — see `iceServers.ts` for why a mistake here
   * must never be able to stop a call.
   */
  function iceServers(): RTCIceServer[] {
    const { servers, problems } = parseIceServers(settings?.().iceServers);
    if (problems.length) {
      console.warn(`call: ignoring ICE server settings that could not be read — ${problems.join(', ')}`);
    }
    return servers.length ? servers : DEFAULT_ICE_SERVERS;
  }

  /**
   * The previous tile object per participant, reused when nothing about them changed.
   *
   * `$each` renders through Solid's `<For>`, which is **keyed by reference**. Rebuilding the tile
   * list produces fresh objects, so every row unmounts and remounts — and a remounted row means a
   * brand-new `<video>` element, which drops `srcObject` and re-attaches it. That is the flicker:
   * every heartbeat, every connection-state change and every mute toggle tore down and rebuilt every
   * video in the call.
   *
   * The codebase already hit this exact failure with `$query` results, where AD4M's prototype `id`
   * getter defeated `reconcile({ key: 'id' })` — see the note in `SchemaRenderer`. Same cause, same
   * symptom, and the fix is the same: keep identity stable across updates that change nothing.
   */
  const tileCache = new Map<string, CallTile>();

  /**
   * Every call activity presence is still prepared to stand behind — the one place liveness is read.
   *
   * ## What it is filtering, and why every reader needs it
   *
   * The kernel lends the RAW peer list: everything the presence driver still holds, which is
   * everyone seen within `evictAfter` — five minutes. Over that time a peer's `liveness` decays
   * through idle and stale to offline, and the activities they last published are carried along
   * completely unchanged. So an agent who closed a tab, crashed, or drove into a tunnel went on
   * saying "I am in this call" for five minutes, because nothing asked how long ago they said it.
   *
   * What that looked like was a tile that would not go away — a frozen last frame, see
   * `hasLiveVideo` for the other half of that, under a badge reading `disconnected` — and a call
   * that stayed joinable in the calls panel long after the last person had left it.
   *
   * It was asked in four places and answered in none of them: this roster, the tile rebuild (which
   * had its own copy of the same loop rather than using it), `liveCalls` and `ongoingPeers`. Hence
   * one helper, so a fix to the question cannot land in three of the four again.
   *
   * ## Why `offline` and not something tighter
   *
   * Two reasons. It is the cut the host already makes for `presenceStore.calls`, so the stage and
   * the calls panel now agree about who is in a call instead of disagreeing for four minutes. And
   * the roster below drives `mesh.setRoster`, so dropping somebody closes their peer connection:
   * cutting at `stale` would tear down a pair after thirty seconds of missed heartbeats that the
   * mesh's own repair ladder is still working on, and a flaky network would be evicted and
   * renegotiated rather than repaired. If the tiles should give up sooner than the mesh does, that
   * is two thresholds, not this one moved.
   *
   * A clean Leave remains the fast path and is untouched: it clears the activity and publishes
   * immediately, so the peer is gone from here on the next tick. This is the backstop for every
   * departure that does not get to say goodbye — which is the one the transport cannot make
   * reliable, since the publish is fire-and-forget over a lossy channel.
   */
  const liveCallActivities = () =>
    activitiesOfType(presence?.peers() ?? [], 'call').filter(({ peer }) => peer.liveness !== 'offline');

  /** Who is in *this* call — the membership the mesh reconciles against. */
  const roster = (): Peer[] => {
    const id = callId();
    if (!id || !presence) return [];
    return liveCallActivities()
      .filter(({ activity }) => activity.id === id)
      .map(({ peer }) => peer);
  };

  /**
   * Rebuild the tile list from the three sources.
   *
   * Driven by the roster, not by the connections: a peer who has joined but not yet negotiated gets a
   * tile with a null stream. Driving it from connections instead would make joiners invisible until
   * their media arrived, which reads as a broken call during the very seconds it is working.
   */
  /**
   * Reuse the previous object for a participant unless their identity or stream changed.
   *
   * Only two fields can force a remount now, and both genuinely require one: a different person, or a
   * different `MediaStream` to attach.
   */
  function stabilise(tile: CallTile): CallTile {
    const previous = tileCache.get(tile.id);
    if (previous && previous.stream === tile.stream && previous.isSelf === tile.isSelf) return previous;
    tileCache.set(tile.id, tile);
    return tile;
  }

  /*
    How many synthetic participants the call bar's dev controls have asked for — see `devPeers`.

    A signal rather than a read of `localStorage` per rebuild, so pressing `+` re-solves the stage on
    the click instead of waiting for whatever roster event happens next. Seeded from storage, which
    is what makes the count survive the reloads a developer does while iterating.
  */
  const [fakePeerCount, setFakePeerCountSignal] = signal(readDevPeerCount());

  function stepFakePeers(by: number) {
    setFakePeerCountSignal(writeDevPeerCount(fakePeerCount() + by));
    rebuildTiles();
  }

  function rebuildTiles() {
    const id = callId();
    const me = selfId?.() ?? null;
    if (!id) {
      tileCache.clear();
      setTiles([]);
      setTileStates([]);
      stopDevPeers();
      return;
    }

    const next: CallTile[] = [];
    const states: Omit<CallTileState, 'focused'>[] = [];

    if (me) {
      const state = controller?.state();
      const own = controller?.displayStream() ?? null;
      const ownWantsPicture = (state?.videoEnabled ?? false) || (state?.screenShareEnabled ?? false);
      const ownPicture = ownWantsPicture && hasLiveVideo(own);
      next.push(stabilise({ id: me, did: me, stream: own, isSelf: true }));
      states.push({
        id: me,
        isScreen: state?.screenShareEnabled ?? false,
        audioEnabled: state?.audioEnabled ?? false,
        videoEnabled: state?.videoEnabled ?? false,
        hasPicture: ownPicture,
        // Your own tile waits on the device rather than on a peer: `join` announces before it calls
        // `getUserMedia`, so this covers the seconds a permission prompt is on screen.
        connecting: ownWantsPicture && !ownPicture,
        // There is no connection to yourself to repair or to describe.
        retrying: false,
        attempts: 0,
        transport: '',
        failed: false,
      });
    }

    // Through the shared helper, which is what this loop used to duplicate without its liveness
    // test — so a peer who had stopped heartbeating kept a tile even once the mesh had let them go.
    for (const { peer, activity } of liveCallActivities()) {
      if (activity.id !== id || peer.agentId === me) continue;
      const settings = activity.media;
      const stream = remoteStreams.get(peer.agentId) ?? null;
      next.push(stabilise({ id: peer.agentId, did: peer.agentId, stream, isSelf: false }));
      const connection = peerStates.get(peer.agentId);
      const repair = recovering.get(peer.agentId);
      const wantsPicture = (settings?.videoEnabled ?? true) || (settings?.screenShareEnabled ?? false);
      const picture = wantsPicture && hasLiveVideo(stream);
      states.push({
        id: peer.agentId,
        // Read from the roster, never inferred from the track — the sender is the only one who knows
        // whether the video it is sending is a camera or a desktop.
        isScreen: settings?.screenShareEnabled ?? false,
        audioEnabled: settings?.audioEnabled ?? true,
        videoEnabled: settings?.videoEnabled ?? true,
        connection,
        hasPicture: picture,
        /*
          Expected and not yet arrived. Keyed on the track rather than on `peerStates`, which holds
          nothing until the first negotiation — exactly the window that showed nothing at all.

          Not once a connection has been made and lost, which is a different sentence. It used to
          exclude `failed` only, and that was enough while a picture that stopped arriving went on
          being counted as a picture: a departed peer sat there frozen rather than claiming to be
          on its way. Now that a muted track reads as no picture — see `hasLiveVideo` — the same
          expression would put "Connecting…" under somebody who has just left the call, which is a
          worse answer than the frozen frame was.

          `disconnected` and `closed` join it for that reason. What a genuine blip shows instead is
          `retrying`, which the mesh sets when it actually starts repairing the pair, and which says
          "Reconnecting…" — true of a connection coming back, and not claimed of one that never
          connected.
        */
        connecting: wantsPicture && !picture && !GONE.has(connection ?? ''),
        // A repair is only worth announcing while the connection has not come back. Reading the
        // connection rather than clearing the map on every state change keeps the two in step
        // without a second source of truth.
        retrying: !!repair && connection !== 'connected',
        attempts: repair?.attempts ?? 0,
        transport: transports.get(peer.agentId) ?? '',
        failed: connection === 'failed',
      });
    }

    /*
      Synthetic participants, when a developer has asked for them — see `devPeers`.

      Appended here rather than injected into the roster, so they cost the mesh and presence nothing
      and cannot be mistaken for a real peer by anything upstream. They go through `stabilise` and
      `tileStates` like everyone else, which is the point: the tiling solve, the spotlight's axis and
      fit-to-content all see exactly what they would in a real call.
    */
    for (const peer of devPeers(fakePeerCount())) {
      next.push(stabilise({ id: peer.id, did: peer.id, stream: peer.stream, isSelf: false }));
      states.push({
        id: peer.id,
        isScreen: false,
        audioEnabled: peer.audioEnabled,
        videoEnabled: true,
        connection: 'connected',
        hasPicture: peer.stream !== null,
        connecting: false,
        retrying: false,
        attempts: 0,
        // A synthetic participant has no connection, so it has no transport to describe. Left empty
        // rather than faked: this exists to make a layout testable, not to make a diagnostic lie.
        transport: '',
        failed: false,
      });
    }

    // Drop anyone who left, so the cache cannot grow across a long-lived session.
    const present = new Set(next.map((tile) => tile.id));
    for (const key of [...tileCache.keys()]) if (!present.has(key)) tileCache.delete(key);

    const focus = reconcileFocus(states, present);

    setTiles(next);
    setTileStates(states.map((state) => ({ ...state, focused: state.id === focus })));
  }

  /**
   * Decide what the stage should be showing, from what changed rather than from what is true.
   *
   * "Somebody is sharing" is the wrong question — it is true for the whole ten minutes of a demo,
   * so answering it would re-take focus from the user on every heartbeat. The question is *who
   * started sharing since last time*, which is why the set of sharers is remembered here rather than
   * recomputed. Somebody else's screen appearing is the one event worth overriding a default for;
   * your own is not, because you know what you just did and you are usually looking elsewhere.
   */
  function reconcileFocus(states: Omit<CallTileState, 'focused'>[], present: Set<string>): string | null {
    const me = selfId?.() ?? null;
    const sharing = new Set(states.filter((state) => state.isScreen).map((state) => state.id));
    const started = [...sharing].find((peerId) => !sharingPeers.has(peerId) && peerId !== me);
    sharingPeers = sharing;

    let focus = focusedId();
    // A focused participant who left takes the focus with them, back to an even grid.
    if (focus && !present.has(focus)) {
      focus = null;
      focusIsManual = false;
    }
    if (started && !focusIsManual) focus = started;

    if (focus !== focusedId()) setFocusedId(focus);
    return focus;
  }

  /**
   * What this call is *about*, held rather than passed around.
   *
   * It used to be a `join` parameter that every `publishActivity` call had to remember to forward,
   * which was survivable while the anchor was fixed at join time. It no longer is — `attachAnchor`
   * can set one mid-call — and a later republish carrying the stale parameter would silently drop it
   * again on the next mute toggle. One place to read it from, so nothing can disagree.
   */
  let anchor: Focus | undefined;

  /**
   * Whether the call this agent is in belongs to a space other than the one on screen.
   *
   * A function rather than an inline comparison because two things ask it — the bar's way back, and
   * the rail's launcher — and they have to agree. The bar showing "back to the call" while the rail
   * thought it was already there would be one of the two doing nothing.
   */
  function callIsElsewhere(): boolean {
    return callId() !== null && !!anchor?.datasetUri && anchor.datasetUri !== (datasetUri?.() ?? null);
  }

  /** Go back to the space the call is in. No-op outside a call. */
  function returnToCall() {
    const uri = anchor?.datasetUri;
    if (callId() && uri) datasets?.open(uri);
  }

  /**
   * The call record this call is about — see `recordCallId`.
   *
   * Held beside `anchor` and for the same reason: it is republished on every activity, so reading it
   * from one place is what stops a later `publishActivity` dropping it.
   *
   * A **signal**, unlike `anchor`, because it is published on the store as `callRecordId` and a
   * template binds to it. A plain `let` is invisible to the reactive graph, so every surface reading
   * "which call is this" resolved once — against the frame before the call existed — and never
   * heard about the record that arrived a moment later. It read as the board, the transcript and
   * the extraction panel all ignoring a call that was plainly running.
   */
  const [callRecord, setCallRecord] = signal<string | null>(null);

  /**
   * The record this agent picked back up, when the call was continued rather than started.
   *
   * Published beside `record` so the transcriber can tell the two apart. A started call's record is
   * empty until somebody speaks, so it waits for the first utterance before writing into it; a
   * continued call's record already holds last time's words, and waiting left every surface reading
   * "nothing has been said" over a transcript that was plainly there. The transcript panel's own
   * Continue button worked around this by telling the transcriber directly, which the rail's path
   * could not do — so the two ways into the same call disagreed about whether it had a transcript.
   *
   * A plain `let` compared against the signal rather than a flag on `join`, because `join` tears the
   * previous call down first and teardown clears the record; the comparison is what survives that.
   */
  let continuedRecord: string | null = null;

  /** Republish the call activity so peers see mute/camera/screen changes. */
  function publishActivity() {
    const id = callId();
    if (!id || !presence) return;
    presence.setActivity({
      type: 'call',
      id,
      media: media(),
      ...(anchor ? { anchor } : {}),
      // What lets transcribe write into the right record without electing a creator, and what a
      // joining peer adopts rather than deriving. Every participant republishes it, so the record
      // survives the starter leaving.
      ...(callRecord() ? { record: callRecord() } : {}),
      // And whether that record pre-existed the call — see `continuedRecord`.
      ...(callRecord() && callRecord() === continuedRecord ? { continued: true } : {}),
    });
  }

  function teardown() {
    const id = callId();
    mesh?.close();
    mesh = null;
    controller?.stop();
    controller = null;
    scopeHandle?.dispose();
    scopeHandle = null;
    setLocalAudio(null);
    remoteStreams = new Map();
    peerStates = new Map();
    recovering.clear();
    transports.clear();
    if (id) presence?.clearActivity('call', id);
    setCallId(null);
    anchor = undefined;
    setCallRecord(null);
    setVisible(false);
    setFocusedId(null);
    focusIsManual = false;
    sharingPeers = new Set();
    setTiles([]);
  }

  /**
   * Start a call: make its record, then join it.
   *
   * ## Why the record comes first, and is never cleaned up
   *
   * The record used to be made by whichever agent's transcriber flushed an utterance first, which
   * meant a call had no identity of its own until somebody spoke. Everything a live call needs to
   * hold — which entities to extract, what it is called, who is in it — had nowhere to live in the
   * meantime, and two agents speaking at once (the ordinary way a meeting begins) raced to create
   * two records for one call. That race was fought with a distributed election, which is now
   * deleted along with the reason for it.
   *
   * Nothing deletes an empty one. A call that produced no transcript still happened, and the only
   * agent who could decide it was worth discarding is one who can see the whole call — which in a
   * partition is nobody. That is the same trap as `mode: 'feed'`: a peer who cannot see the other
   * half of the conversation must never conclude the conversation was empty. The Calls list folds
   * empties away instead, which is a display decision and reversible.
   *
   * A failure to create is a refusal to start, not a call without a record: half a call is worse
   * than an error, because the transcript would silently go nowhere.
   */
  /**
   * Open the transport a call would run on, or say why it cannot.
   *
   * Every refusal `join` makes that is knowable without a call id: a signed-in agent, a transport, a
   * shared space, and a capability profile that can carry unicast. Answers with the *scope* rather
   * than a verdict, and the caller hands it back to `join` — asking the question requires opening
   * one, and opening a second would be a reference to account for on every path through both.
   */
  function openCallScope(): { scope: EphemeralScope } | { reason: string } {
    const handle = dataset?.() ?? null;
    const me = selfId?.() ?? null;
    if (!handle || !me) return { reason: 'A call needs a space and a signed-in agent.' };
    if (!ephemeral || !presence) return { reason: 'This host has no transport for calls.' };
    /*
      The manifest requires this kernel, so registration should already have refused a host without
      it — this is the degradation the contract asks for anyway, since a required kernel absent from
      the bag is a host bug and not a reason to throw from a button. Refused here, with the other
      refusals knowable without a call id, so `startCall` writes no record for a call the mesh could
      never carry. Warned as well as surfaced, because the sentence the user sees says what they
      cannot do and the console line says why the host let it get this far.
    */
    if (!peerConnection) {
      console.warn('call: the host lends no `peerConnection` kernel, so no connection can be made');
      return { reason: 'This host cannot connect a call between peers.' };
    }

    const scope = ephemeral(handle);
    // A personal space has no neighbourhood — there is nobody to call. Say so rather than
    // presenting controls that will never connect.
    if (!scope) return { reason: 'Calls need a shared space. This one is personal.' };

    /*
      Refuse loudly rather than half-working, the same discipline as `planQuery`. A transport with
      `unicast: 'none'` would deliver every offer to everyone, and each bystander would negotiate a
      connection nobody asked for.

      `confidential` is deliberately *not* requested. It would be the honest flag — an SDP offer
      names your host candidates — but demanding native unicast would refuse to run on AD4M, whose
      addressing is emulated. The trade is stated rather than hidden: on an emulated transport,
      everyone in the space can see the handshake, and the media itself is still DTLS-encrypted
      end-to-end regardless.
    */
    const plan = planEphemeral({ consumer: 'call', unicast: 'emulated' }, scope.capabilities);
    if (plan.runnable) return { scope };

    // Released, not abandoned. This used to be assigned to `scopeHandle` the moment it was opened
    // and every refusal below returned without disposing, so a join against a transport that cannot
    // carry a call leaked one reference on the backend's scope, once per attempt.
    scope.dispose();
    return { reason: plan.gaps.map((gap) => gap.note).join(' ') };
  }

  async function startCall(anchorNodeId?: string) {
    // Whatever this makes is new, so nothing about a continued record carries over.
    continuedRecord = null;
    const uri = datasetUri?.() ?? null;
    if (!uri) {
      setProblem('A call needs a space.');
      return;
    }
    if (!records) {
      setProblem('This host cannot record calls.');
      return;
    }
    setProblem(null);

    /*
      Everything `join` would refuse for, asked *before* anything is written.

      The record used to be created first and `join` called afterwards, so every failed start left a
      `CollectionBlock` in the space for a call that never happened — one per press, all of them
      `kind: 'call'`, all of them showing up wherever calls are listed, with no participants and no
      transcript and no way to tell them from a real call nobody spoke in. On a personal space,
      where a call can never work, pressing the button was purely a way to litter.

      Duplicated rather than shared with `join` because `join` is also reached from the roster — a
      peer's call already exists, so its refusals have nothing to undo and it stays the one place
      that owns the message. Here the question is only "is it worth writing a record", and the
      answer must be reached without writing one.
    */
    const opened = openCallScope();
    if ('reason' in opened) {
      setProblem(opened.reason);
      return;
    }

    let recordId: string | null = null;
    try {
      recordId = await records.create(
        'CollectionBlock',
        // Feed mode: every participant's transcriber appends to this one record, so it has no single
        // authoring agent and must never be reconciled.
        { kind: CALL_KIND, type: 'collection', mode: 'feed' },
        anchorNodeId ? { parent: { id: anchorNodeId, predicate: CALL_PREDICATE } } : undefined,
      );
    } catch (cause) {
      console.error('call: could not create the call record', cause);
    }
    if (!recordId) {
      // The transport was opened to answer the question above; nothing is going to use it now.
      opened.scope.dispose();
      setProblem('Could not start the call.');
      return;
    }
    await join(
      recordCallId(recordId),
      anchorNodeId ? { datasetUri: uri, nodeId: anchorNodeId } : undefined,
      recordId,
      opened.scope,
    );
  }

  /**
   * Start a call **on a record that already exists** — picking a past conversation back up.
   *
   * `startCall` writes a record and joins the call that record names. Continuing one is the same act
   * with the first half already done, and doing it through `startCall` was the bug: pressing
   * "continue this call" wrote a *second* `CollectionBlock` and joined that, so the space gained an
   * empty call, every surface reading `callRecordId` pointed at it, and the transcript went to the
   * record you had actually chosen. Two calls where you asked for one, disagreeing about which
   * meeting you were in.
   *
   * A call *is* its record — `recordCallId` derives the id from it — so continuing needs no new
   * identity and no write. Anyone else who picks the same record up lands in the same call, which is
   * the property that makes this safe to press twice.
   *
   * Joining rather than checking for a live one first, as `goToCall` does: this names the call it
   * wants, so "is something else running" is not the question. `join` tears down whatever is running
   * before it starts, which is the same one-call-at-a-time rule every other entry point obeys.
   */
  async function continueCall(recordId: string) {
    if (!recordId) return;
    continuedRecord = recordId;
    const uri = datasetUri?.() ?? null;
    if (!uri) {
      setProblem('A call needs a space.');
      return;
    }
    setProblem(null);

    // The same question `startCall` asks before it writes: can this transport carry a call at all?
    // Asked here too, so continuing into a space that cannot host one says so rather than failing
    // silently halfway through a join.
    const opened = openCallScope();
    if ('reason' in opened) {
      setProblem(opened.reason);
      return;
    }

    await join(recordCallId(recordId), { datasetUri: uri }, recordId, opened.scope);
  }

  /**
   * `preopened` is the scope `startCall` already opened to decide whether to write a record at all.
   * Passed through rather than opened again, so one join is one reference however it was reached.
   */
  async function join(id: string, joinAnchor?: Focus, recordId?: string, preopened?: EphemeralScope) {
    if (callId() === id) {
      preopened?.dispose();
      return;
    }
    // One call at a time, and this is where that is decided: joining a second tears the first down
    // rather than running both. Everything below assumes a single mesh, a single scope and a single
    // set of local tracks, and the stage has one spotlight.
    if (callId()) teardown();

    setProblem(null);

    const uri = datasetUri?.() ?? null;

    /*
      A call always says which space it is in, even when it is not *about* anything in particular.

      An unanchored activity used to be enough, because a call could only be published into the space
      you were standing in. Now that a call outlives navigating away from it, the space is no longer
      derivable from where you happen to be — the host routes the activity to the call's own presence
      source, and this is what tells it which that is.

      A space-wide call carries `datasetUri` and no `nodeId`, which is exactly what consumers already
      test for: `transcribe` reads `anchor?.nodeId ?? null`, so this reads identically to the absent
      anchor it replaces.
    */
    anchor = joinAnchor ?? (uri ? { datasetUri: uri } : undefined);
    // Given by `startCall`, otherwise read off whoever is already in this call. A call with neither
    // is one whose starter has left and whose record nobody republished, which the roster cannot
    // happen while anyone is in it.
    setCallRecord(recordId ?? liveCalls().find((call) => call.id === id)?.recordId ?? null);

    // Every refusal lives in `openCallScope`, so joining from the roster and starting a call check
    // exactly the same things and say exactly the same words.
    const opened = preopened ? { scope: preopened } : openCallScope();
    if ('reason' in opened) {
      setProblem(opened.reason);
      return;
    }
    const scope = opened.scope;
    // `openCallScope` already refused an absent identity; re-read for the type rather than
    // asserting, so a sign-out racing the join still ends here rather than half way in.
    const me = selfId?.() ?? null;
    if (!me) {
      scope.dispose();
      setProblem('A call needs a space and a signed-in agent.');
      return;
    }
    // Same shape as `me`: `openCallScope` refused its absence, and this re-read is for the type.
    const connections = peerConnection;
    if (!connections) {
      scope.dispose();
      setProblem('This host cannot connect a call between peers.');
      return;
    }

    scopeHandle = scope;
    setCallId(id);
    /*
      Starting a call shows the call.

      Nothing did this, so the first thing that happened when you pressed the call button was that
      the bar appeared and the video did not: the panel is placed only while `stageOpen` is true, and
      nothing set it. The only way to a visible stage was the expand toggle, which reads as a way to
      *change* something already on screen — so the call looked like it had failed to start any
      picture at all.

      Placing it is a separate question from showing it, and not this module's: the stage opens as a
      floating card, and where it goes from there is the host's, on the panel itself. Leaving a call
      sets this back off, so it means "this call is showing" rather than a preference that outlives
      the call it was made in.
    */
    setVisible(true);

    // coalesce: false, emphatically. Presence heartbeats are last-write-wins so a dropped one costs
    // nothing; an SDP offer dropped because the previous send was slow is simply lost, and that peer
    // never connects.
    const channel = scope.channel('rtc', { coalesce: false });

    /*
      Spend the transport's first-send cost on something that does not matter.

      The AD4M adapter documents it: the *first* `sendBroadcastU` on a freshly joined neighbourhood
      has been measured at eighteen seconds, and every send after it at tens of milliseconds — the
      signature of two conductors discovering each other, paid once per channel. Until now the
      message that paid it was the first SDP offer, so the opening handshake of a call could sit
      unsent for the better part of twenty seconds while both peers waited on each other. That is the
      single best explanation for why the *start* of a call is the frustrating part and why several
      rounds of leaving and rejoining make it behave.

      So a throwaway goes first. It parses to nothing on every peer — `parseCallMessage` rejects a
      missing `kind` — which is the entire design: it has to be a real publish to be worth anything,
      and it must mean nothing to anybody who receives it.

      Once per channel, not once per join. The cost being dodged is paid by a channel's first send
      and never again, and `scope.channel` returns the same object for a tag, so a second call in the
      same space would be sending a message with nothing left to buy. A `WeakSet` rather than a flag
      because the channels belong to scopes that come and go with the spaces they serve.
    */
    if (!warmed.has(channel)) {
      warmed.add(channel);
      channel.publish({ v: CALL_PROTOCOL_VERSION, call: id, warm: true });
    }

    mesh = createCallMesh({
      callId: id,
      selfId: me,
      channel,
      // The deployment's, a community's, or this agent's — and the module's own where nobody said.
      // See the `iceServers` setting in `index.ts` for why this is reachable at all.
      iceServers: iceServers(),
      // The host lends the constructor; the ICE opinion stays the mesh's — see `DEFAULT_ICE_SERVERS`.
      createPeerConnection: (configuration) => connections.create(configuration),
      onRemoteStreamsChanged: (streams) => {
        remoteStreams = streams;
        rebuildTiles();
      },
      onPeerStateChanged: (peerId, state) => {
        peerStates.set(peerId, state);
        if (state === 'connected') {
          recovering.delete(peerId);
          // Asked once per settled connection rather than polled: the answer only changes when ICE
          // re-selects a pair, which is exactly what reaching `connected` means.
          void mesh?.transportOf(peerId).then((kind) => {
            if (!kind) return;
            transports.set(peerId, kind);
            rebuildTiles();
          });
        }
        if (state === 'closed') transports.delete(peerId);
        rebuildTiles();
      },
      onPeerRecovery: (peerId, attempt) => {
        recovering.set(peerId, attempt);
        rebuildTiles();
      },
      onError: (context, error) => console.error(`call: ${context}`, error),
    });

    controller = createMediaController({
      /*
        The camera and microphone go through the host's `media` kernel rather than `navigator`
        directly, so a module's use of a device is something the host can see and the manifest's
        `permissions` describe. The controller's own default — `navigator.mediaDevices` — remains
        the fallback for a host that lends no kernel, which is what a test is.
      */
      devices: mediaKernel
        ? {
            getUserMedia: (constraints) => mediaKernel.getUserMedia(constraints),
            getDisplayMedia: (constraints) => mediaKernel.getDisplayMedia(constraints),
          }
        : undefined,
      onTrackChanged: (kind, track) => void mesh?.setOutboundTrack(kind, track),
      onStateChanged: (state) => {
        setMedia({ ...state });
        // Devices arrived after all — most likely the user granted the permission and pressed the
        // camera button. Each message clears on its own condition, and only its own, so neither a
        // structural problem nor the other media one is swallowed.
        const local = controller?.localStream();
        if (problem() === MEDIA_BLOCKED && local) setProblem(null);
        if (problem() === CAMERA_BLOCKED && local?.getVideoTracks().length) setProblem(null);
        // A lost device that has come back clears its own message, on the same terms as the two
        // above: each on its own condition, so one recovery cannot swallow another's report.
        if (problem() === MIC_LOST && local?.getAudioTracks().length) setProblem(null);
        if (problem() === CAMERA_LOST && local?.getVideoTracks().length) setProblem(null);
        // Fires once when devices are acquired, and on every mute after — the first is what tells a
        // listener the microphone exists at all.
        setLocalAudio(controller?.localStream() ?? null);
        publishActivity();
        rebuildTiles();
      },
      /*
        A device left. The controller has already corrected the state and republished; this is the
        half that tells the person, because the microphone case is otherwise undiscoverable — they
        look muted to everyone and there is nothing on their own screen to say why.
      */
      onDeviceLost: (kind) => setProblem(kind === 'audio' ? MIC_LOST : CAMERA_LOST),
      onError: (context, error) => console.error(`call: ${context}`, error),
    });

    // Announce before acquiring devices: joining should be visible to peers immediately, and the
    // permission prompt can take as long as the user takes.
    publishActivity();
    rebuildTiles();

    const started = controller;
    /*
      Told which devices to use before it opens anything.

      `setDevice` with nothing open only records the choice, which is exactly what is wanted here:
      the controller then asks for them on its first acquisition rather than opening the system
      default and switching a moment later, which would prompt twice on some platforms and show a
      second of the wrong camera on all of them.

      A stored id is a hint rather than a promise — see `devices.ts` — so one that has since been
      unplugged makes the acquisition fail, and the controller's own ladder takes over: audio-only,
      then nothing, each reported. That is the right answer for a device that has gone, and it is
      why the choice is pinned with `exact` rather than hinted: a soft constraint would silently
      open something else while the picker went on claiming the device it no longer had.
    */
    await started.setDevice('audio', audioDevice());
    await started.setDevice('video', videoDevice());
    await started.start();

    /*
      Now that permission has been answered, ask again what is here.

      Labels are empty until a capture has been granted at least once — the browser withholds them
      so a page cannot fingerprint a machine by its hardware. So the list gathered before a call is
      a list of anonymous devices, and this is the first moment it can have names in it.
    */
    setDevicesProbed(true);
    void refreshDevices();

    // The call can end while the permission prompt is up — a hot reload, a second join, somebody
    // pressing leave. `teardown` nulls the controller, so the check below has to be against the one
    // this join created rather than against whatever is current.
    if (controller !== started) return;

    /*
      Say why there is no picture, rather than showing an avatar and leaving them to guess.

      `problem` is a dismissible alert over the call, not a replacement for it — which is the right
      shape here: a blocked camera does not stop you watching and hearing everyone else, so the call
      carries on and the reason is stated once. Checked on the stream rather than on an error,
      because a refused camera that fell back to audio is a different outcome from a refused
      *request*, and only the second one leaves nothing at all.
    */
    if (!started.localStream()) setProblem(MEDIA_BLOCKED);
  }

  // Reconcile the mesh against the roster. This is the whole membership mechanism — see mesh.ts.
  effect?.(() => {
    const peers = roster();
    if (!mesh) return;
    mesh.setRoster(peers.map((peer) => peer.agentId));
    rebuildTiles();
  });

  /*
    Leaving the space no longer leaves the call.

    It used to, on the grounds that staying connected to a call in a space you have navigated out of
    is a surprise — and, decisively, that "the transport scope is torn down under us anyway". The
    second half was the real reason, and it is no longer true: this store holds its own refcounted
    handle on the call's scope for as long as the call lasts, and the host now keeps a presence
    source open for any space holding a live activity, so the roster survives too.

    That leaves only the first half, and it is the wrong way round. Being dropped out of a call
    because you went to look something up is the surprise; a call you have to stay still for is not
    one you can use. So the call ends when somebody ends it, and nothing else — hanging up, joining
    another (see `join`), or losing the module.

    Nothing replaces this effect. There is deliberately no "the dataset went away" case: a null
    dataset is the boot frame and the moment between spaces as much as it is anything final, and
    tearing a call down on it is what this was doing wrong in the first place.
  */

  /*
    Signing out leaves the call.

    `SessionStore.logout` locks the agent and returns to the sign-in screen; nothing called `leave`,
    so the `getUserMedia` tracks, the peer connections and the presence scope survived it. The
    camera light stayed on through the login screen and after signing back in — on desktop, where
    the app does not reload. Web was fine only by accident: it reloads, which closes everything.

    Watched through `selfId` rather than through a new lifecycle hook, because that is exactly what
    signing out *is* from a module's point of view — the agent this call belongs to is no longer
    here. The `hadIdentity` latch is what keeps it from firing on the boot frames before the first
    login, where `selfId` is null and always was.
  */
  let hadIdentity = false;
  effect?.(() => {
    if (selfId?.()) {
      hadIdentity = true;
      return;
    }
    if (hadIdentity && callId()) teardown();
  });

  /*
    Deleting the call's space ends the call.

    Nothing did. `removeDataset` tore the perspective down and left this store holding the
    `getUserMedia` tracks, every `RTCPeerConnection` in the mesh and a presence lease still
    heartbeating into a perspective that no longer existed — a call whose space had been deleted
    carried on, with a camera light and no way back to what it was about.

    Subscribed rather than derived, because the absence a removal leaves is indistinguishable from
    every other absence: `datasets.get(uri)` is `undefined` during boot, while the list loads, and
    for a space this agent never joined. Only the host can say which one is a removal.

    `anchor.datasetUri` is what a call is anchored to, so that is what is compared. A call with no
    anchor is in a personal space, which has no uri and cannot be the subject of one of these.
  */
  onDispose?.(
    datasets?.onRemoved?.((removedUri) => {
      if (callId() && anchor?.datasetUri === removedUri) teardown();
    }) ?? (() => {}),
  );

  /**
   * Losing the module leaves the call too.
   *
   * Until the contract had teardown, unregistering this module — or merely re-registering it, which
   * a hot reload does — dropped the only reference to live `RTCPeerConnection`s and a
   * `getUserMedia` stream. Nothing was left able to close them and the camera light stayed on. It is
   * the same `teardown()` a deliberate hangup runs; the only new thing is that somebody now calls it.
   */
  onDispose?.(() => teardown());

  /**
   * How the tiles are arranged, as reported by the stage.
   *
   * This module no longer decides it. It used to, from the participant count alone — two columns up
   * to four people, three beyond — and the panel's *shape* was not an input at all, so a call
   * dragged tall and thin got two columns of postage stamps and one dragged wide got two rows with
   * bands of empty panel above and below. The comment here claimed a tall dock wanted one or two
   * columns; the code had no width to make that true with, and had not since a panel stopped being
   * defined by which edge it was on.
   *
   * `Grid`'s `childAspect` solves it properly — largest 16:9 tiles for the box, both axes — and
   * reports what it settled on. Read here for two things only the module can answer: what shape the
   * panel wants at fit-to-content, and where a spotlight should put everyone else.
   */
  const [arrangement, setArrangement] = signal<{ columns: number; rows: number }>({ columns: 1, rows: 1 });

  /**
   * The stage's own box, reported by the grid — see `Grid`'s `onMeasure`.
   *
   * Used for one decision and no arithmetic: which edge the filmstrip runs along. The thicknesses
   * themselves are written in container-query units, so they stay right between measurements rather
   * than lagging a frame behind a drag.
   */
  const [stageBox, setStageBox] = signal<{ width: number; height: number }>({ width: 0, height: 0 });

  /**
   * Whether the spotlight has the stage to itself.
   *
   * A second mode rather than a third click, because a three-state cycle on one gesture cannot say
   * which state it is in — the same trap the show/hide toggle was split apart to escape. It is a
   * toggle in the bar, visible only while something is focused, so the state is on screen and the
   * move has a name.
   *
   * The strip is what you give up, and it is worth giving up mainly for a shared screen: reading
   * somebody's desktop you want every pixel and the faces are not the point.
   */
  const [solo, setSolo] = signal(false);

  /** How many tiles the strip holds — everyone but the one with the stage. */
  const stripCount = () => Math.max(1, tiles().length - 1);

  /** The strip's own solve, against the box the grid last reported — see `solveStrip`. */
  const stripLayout = () => solveStrip(stripCount(), stageBox(), { aspect: TILE_ASPECT, gap: STAGE_GAP_PX });

  /**
   * Every call running in this space right now, whichever this agent is in — the join surface.
   *
   * This replaced a single derived id. While a space could hold exactly one call, "is there a call
   * on?" was a membership test against `spaceCallId(uri)` and a prompt could say *the* call. Calls
   * are now identified by their own record, so there can be several, and the question a person is
   * actually asking is "which of these do I want" — a list, not a boolean.
   *
   * Assembled from presence alone, so a call appears here the instant its starter publishes and
   * disappears on TTL when the last participant goes, with no store of its own to keep in step.
   * Peers in a call whose record nobody has republished are still listed: an unnamed call you can
   * join is better than a call that is invisible.
   */
  const liveCalls = () => {
    const uri = datasetUri?.() ?? null;
    const me = selfId?.() ?? null;
    if (!uri || !presence) return [];
    const byCall = new Map<
      string,
      { id: string; recordId: string | null; anchorNodeId: string | null; peers: string[] }
    >();
    for (const { peer, activity } of liveCallActivities()) {
      const anchorOf = (activity as { anchor?: Focus }).anchor;
      if (anchorOf?.datasetUri && anchorOf.datasetUri !== uri) continue;
      const recordId = (activity as { record?: string }).record ?? null;
      const existing = byCall.get(activity.id);
      if (existing) {
        if (!existing.peers.includes(peer.agentId)) existing.peers.push(peer.agentId);
        existing.recordId ??= recordId;
        continue;
      }
      byCall.set(activity.id, {
        id: activity.id,
        recordId,
        anchorNodeId: anchorOf?.nodeId ?? null,
        peers: [peer.agentId],
      });
    }
    return [...byCall.values()].map((call) => {
      const faces = call.peers.map((agentId) => {
        const face = faceOf(agentId);
        return { image: face.image, hash: face.hash, initials: face.name, did: agentId };
      });
      /*
        What the call is called, derived rather than stored.

        A list of calls needs each row to be tellable from the others, and the honest answer is who
        is in it — which is live, so it needs no writing and cannot go stale. Writing a title at
        creation would have to guess: the only agent present when the record is made is the one
        starting it, so "Anna's call" would be the name of a meeting of six.

        Falls back to "Call" rather than to a timestamp: a row already sits beside its own faces and
        a count, and a clock reading would be the least distinguishing thing on it.
      */
      const names = call.peers
        .map((agentId) => identities?.get(agentId)?.name)
        .filter((name): name is string => !!name);
      return {
        ...call,
        faces,
        count: call.peers.length,
        mine: !!me && call.peers.includes(me),
        label: names.length ? names.join(', ') : 'Call',
      };
    });
  };

  /** Everyone in a call in this space, whether or not this agent has joined — so the bar can offer
   *  "3 in a call · Join" rather than only appearing once you are already in one. */
  const ongoingPeers = () => {
    const uri = datasetUri?.() ?? null;
    if (!uri || !presence) return [];
    return (
      liveCallActivities()
        .filter(({ activity }) => {
          const anchorOf = (activity as { anchor?: Focus }).anchor;
          return !anchorOf?.datasetUri || anchorOf.datasetUri === uri;
        })
        // Faces, not peers. This feeds an `AvatarStack`, which reads `image`/`hash`/`initials` and
        // draws a generic person glyph for anything else — so handing it raw presence records, which
        // carry an agent id and no profile at all, drew one grey silhouette per participant.
        // No `tone`: everyone in this list is in the call right now, so a liveness ring would be
        // encoding a distinction that cannot vary here. `initials` rather than `name`, because
        // that is the prop an avatar asks for — it derives the letters from the name it is given.
        .map(({ peer }) => {
          const face = faceOf(peer.agentId);
          return { image: face.image, hash: face.hash, initials: face.name, did: peer.agentId };
        })
    );
  };

  /**
   * The shape the stage's content wants, so the host can offer "fit to content".
   *
   * Every tile is 16:9 and they divide the stage evenly, so for any width there is exactly one
   * height at which no band of empty panel is left above or below the pictures — the thing
   * hand-resizing can never quite land on. `cols × 16 / (rows × 9)` is that shape.
   *
   * The insets are the stage's own fixed pixels: `STAGE_PADDING_PX` on each side and
   * `STAGE_GAP_PX` between tiles. Left out — as they were at first — the host solved on the full
   * panel width, made the box about twenty pixels too short for its pictures, and the tiles
   * answered by shrinking to the height and leaving a gap down each side. They are constants at a
   * given tile count, which is what lets this stay a value rather than a callback taking a width.
   *
   * The arrangement is the one the stage is *currently in*, not one solved again here. That is
   * deliberate: with the width fixed, any column count can be made to fit perfectly, so "fit" that
   * re-solved could rearrange the call under a click that only asked to remove the empty band.
   * This takes the slack out and leaves the tiles where they are.
   */
  function stageAspect(): DockAspect {
    /*
      Spotlight and solo are one 16:9 picture with a band beside or beneath it, so the shape is the
      tile's and the strip is an inset — which is exactly the pair this contract asks for, and the
      same band the tracks are written from.
    */
    if (focusedId() !== null) {
      const strip = stripLayout();
      const band = solo() ? 0 : strip.thickness + STAGE_GAP_PX;
      const beside = !solo() && strip.side;
      return {
        ratio: TILE_ASPECT,
        insetX: STAGE_PADDING_PX * 2 + (beside ? band : 0),
        insetY: STAGE_PADDING_PX * 2 + (!solo() && !strip.side ? band : 0),
      };
    }

    const { columns, rows } = arrangement();
    return {
      ratio: (columns * 16) / (rows * 9),
      insetX: STAGE_PADDING_PX * 2 + (columns - 1) * STAGE_GAP_PX,
      insetY: STAGE_PADDING_PX * 2 + (rows - 1) * STAGE_GAP_PX,
    };
  }

  return {
    // ── State ────────────────────────────────────────────────────────────────
    callId: state(callId, 'The id of the call this agent is in, or null between calls.'),
    /** The call record this agent's call writes into — what transcribe and the panels read. */
    callRecordId: state(
      () => callRecord() ?? '',
      "The id of the call record this agent's call writes into — what a transcript, a board or a call's page follows — or empty between calls.",
    ),
    liveCalls: state(
      liveCalls,
      'Every call running in the space on screen, whichever this agent is in — { id, recordId, anchorNodeId, peers, faces, count, mine, label } per call.',
    ),
    tiles: state(
      tiles,
      'One entry per participant in the call — { id, did, stream, isSelf } — changing only when somebody joins, leaves or their stream changes.',
    ),
    tileStates: state(
      tileStates,
      "Each participant's volatile flags by id — muted, camera, screen, connection, focused, hasPicture, plus retrying, attempts and transport for how the connection is faring — looked up with find() so a tile never remounts.",
    ),
    focusedId: state(focusedId, 'Whose tile the stage is giving most of its room to, or null for an even grid.'),
    media: state(
      media,
      "This agent's own { audioEnabled, videoEnabled, screenShareEnabled } — what the mute, camera and share toggles reflect.",
    ),
    microphones: state(
      () => inputDevices().filter((device) => device.kind === 'audioinput'),
      'The microphones this machine has — { deviceId, label, groupId } each. A label is empty until capture has been allowed once.',
    ),
    cameras: state(
      () => inputDevices().filter((device) => device.kind === 'videoinput'),
      'The cameras this machine has, on the same terms as microphones.',
    ),
    audioDevice: state(audioDevice, 'The microphone this agent has chosen, or empty for whatever the system offers.'),
    videoDevice: state(videoDevice, 'The camera this agent has chosen, or empty for whatever the system offers.'),
    microphoneOptions: state(
      () => optionsFor('audioinput', 'microphone'),
      'The microphones as picker options, "System default" first — ready for a we-select.',
    ),
    cameraOptions: state(
      () => optionsFor('videoinput', 'camera'),
      'The cameras as picker options, on the same terms as microphoneOptions.',
    ),
    devicesProbed: state(
      devicesProbed,
      'Whether this machine has been asked for a device yet. Until it has, an empty device list means "not allowed to look", not "none here".',
    ),
    devicesNamed: state(
      () => inputDevices().some((device) => !!device.label),
      'Whether this machine will say what its devices are called. False until capture has been allowed once.',
    ),
    deviceSettingsOpen: state(deviceSettingsOpen, 'Whether the camera and microphone chooser is open.'),
    problem: state(
      problem,
      'Why the call could not start or a device could not be reached, as a sentence to show, or null.',
    ),

    // ── What the host reads to place the stage ────────────────────────────────
    /**
     * How the stage would like to open — the panel declaration's `bid`, read as a store key because
     * the shape is state.
     *
     * The module's entire statement about geometry, and it is an opening bid and nothing else: the
     * bottom edge, a small card, floating. It does not know the sidebar's width, the module rail's,
     * or the size of the window — the host owns all of that, which is what lets the same declaration
     * inset on a monitor and overlay on a laptop with nothing here changing. Size, position, whether
     * it displaces content and whether it covers the screen are all the host's afterwards, on the
     * panel's own titlebar, so this module has no opinion about layout left beyond "a card, to begin
     * with".
     *
     * `float` because the stage floats when it opens; whether it goes on to *take room* is the
     * host's toggle, and this module neither sets it nor reads it. That is the point of the split: a
     * call knows how much of your attention it wants, and the app knows how the app is laid out.
     *
     * `aspect` is the one part that varies — see `stageAspect`. It is why this is a key rather than
     * a static bid on the declaration: the shape the panel wants at "fit to content" depends on how
     * many people are in the call and who has the spotlight.
     *
     * This used to be four keys — `dockEdge`, `dockSize`, `dockFloat`, `dockAspect` — with the edge
     * doubling as "is it placed" by going null. Openness is the panel's own `open` key now
     * (`stageOpen`), so the bid can say what it wants and nothing else.
     */
    stageBid: (): PanelBid => ({ edge: 'bottom', size: 'sm', float: true, aspect: stageAspect() }),

    /*
      Synthetic participants, and the two controls that change how many — see `devPeers`.

      Spread conditionally rather than declared and left inert, so a production build's store does
      not carry a `setFakePeers` a template could find and call. Nothing else here is conditional;
      this is the one member that must not exist rather than merely do nothing.
    */
    ...(devPeersAvailable
      ? {
          fakePeerCount,
          /*
            A step rather than a setter, because the schema layer has no arithmetic — there is no
            token for "the current count minus one", so a `+`/`−` pair has to be two actions.

            Both re-solve the stage on the click. Reading storage per rebuild instead would leave it
            showing the old count until whatever roster event happened next, which for a button you
            press while watching the thing it changes is the whole of the feedback.
          */
          addFakePeer: () => stepFakePeers(1),
          removeFakePeer: () => stepFakePeers(-1),
        }
      : {}),

    /**
     * Whether the video is showing at all — what the show/hide button reflects, and the panel
     * declaration's `open` key. Module-owned because it is a fact about the call, not the screen:
     * `join` raises it and `teardown` lowers it, and the host reads rather than holds it.
     */
    stageOpen: visible,
    /**
     * Show the video. The panel declaration's `show` — a template's `meta.panels` entry naming this
     * module's stage calls it to open it, since the module owns the flag the host would otherwise
     * have set itself. Idempotent, like `goToCall`'s use of the same setter.
     */
    openStage: () => setVisible(true),

    // ── How the tiles pack ────────────────────────────────────────────────────
    /**
     * What the stage settled on — wired to `Grid`'s `onArrange`.
     *
     * A setter on the store because the arrangement is decided where it can be measured, and needed
     * where the panel's geometry is decided. The alternative was for this module to import the
     * solver and re-derive it, which would mean a module depending on the design system — an edge
     * the package layering does not have — and two copies of an answer that must agree.
     *
     * Public, because an interface that draws its own stage out of the `tile` part has to report
     * what its grid settled on the same way this module's stage does, or "fit to content" fits the
     * wrong shape.
     */
    setArrangement: action(
      setArrangement,
      'Report the { columns, rows } a stage grid settled on, so fit-to-content can solve for it.',
    ),
    arrangement: state(arrangement, 'The { columns, rows } the stage is currently laid out in.'),
    setStageBox,
    solo: state(solo, 'Whether the spotlight has the stage to itself, with everyone else hidden.'),

    /**
     * The stage's grid tracks while somebody has the spotlight — `undefined` the rest of the time.
     *
     * Undefined is what hands the layout back to `Grid`'s own solver: `template` takes precedence
     * over `childAspect`, so writing tracks here turns the equal-tile solve off and leaving it
     * absent turns it back on. Two modes, one prop, and no mode flag to keep in step with anything.
     *
     * Spotlight is not a span in the equal grid, which is what it used to be and why it barely
     * looked focused: the tracks were solved for N tiles of one size, so the spotlight could only
     * ever be two of them — two thirds of the stage at three people, one third at six. The tracks
     * are the spotlight's own now.
     */
    stageTemplate: (): string | undefined => {
      if (focusedId() === null) return undefined;
      if (solo()) return '1fr';
      const strip = stripLayout();
      const track = strip.scroll ? `${strip.tile}px` : '1fr';
      return strip.side ? `1fr ${strip.thickness}px` : `repeat(${strip.count}, ${track})`;
    },

    stageRows: (): string | undefined => {
      if (focusedId() === null) return undefined;
      if (solo()) return '1fr';
      const strip = stripLayout();
      const track = strip.scroll ? `${strip.tile}px` : '1fr';
      return strip.side ? `repeat(${strip.count}, ${track})` : `1fr ${strip.thickness}px`;
    },

    /**
     * The picture box's own sizing.
     *
     * A 16:9 box as wide as the cell's height allows, so the picture is the right shape whatever
     * proportions the panel has been dragged to — and the name and badges anchored to its corner land
     * *on the video* rather than in the empty half of a cell they nominally shared.
     *
     * The container query is what makes that possible: `container-type: size` on the cell (see
     * `tileCells`) is what `100cqh` measures.
     */
    pictureStyle: (): Record<string, string> => ({
      'aspect-ratio': '16 / 9',
      width: 'min(100%, calc(100cqh * 16 / 9))',
      margin: 'auto',
    }),

    /**
     * Each participant's face, looked up by id exactly as their volatile flags are.
     *
     * Not on the tile, for the reason nothing else is: `$each` renders through a reference-keyed
     * `<For>`, so folding a profile onto the tile object would remount that participant's row the
     * moment their picture arrived — and a remounted row drops `srcObject`. Somebody's video would
     * blink out precisely when their avatar loaded, which is a strange enough symptom to be worth
     * naming twice.
     */
    tileFaces: (): { id: string; image?: string; hash: string; name?: string }[] =>
      tiles().map((entry) => ({ id: entry.id, ...faceOf(entry.did) })),

    tileCells: (): { id: string; style: Record<string, string | number> }[] => {
      const focus = focusedId();
      /*
        Where the spotlight sits in the tracks `stageTemplate` wrote.

        It takes the whole of the axis the strip does not run along — the full height beside a strip
        down the side, the full width above one underneath — and the others auto-place into what is
        left, one per track, in the order they are in. Explicit placement rather than `order`, which
        is what it used to need when the spotlight was a span in a grid solved for equal tiles.
      */
      /*
        The spotlight's cell fills with its box rather than centring it.

        Every other cell centres what it holds, which is right for a picture smaller than its cell.
        This one holds the *pinned* box — see `tilePins` — and a sticky element's range is measured
        from where it would have sat: centred in a column several times the height of the stage, it
        starts halfway down and scrolls out of view before it ever reaches the top edge it is
        supposed to stick to. Stretched from the start of the cell, it pins as intended.
      */
      const fills: Record<string, string | number> = { 'justify-content': 'flex-start', 'align-items': 'stretch' };
      const spotlight: Record<string, string | number> = stripLayout().side
        ? { ...fills, 'grid-column': '1', 'grid-row': '1 / -1' }
        : { ...fills, 'grid-row': '1', 'grid-column': '1 / -1' };
      /**
       * Every cell is a size container, which is what lets the picture inside it be the right shape.
       *
       * A cell is whatever the panel's proportions make it — and a picture cannot be fitted into an
       * arbitrary box by CSS alone unless something can be measured. `container-type: size` makes the
       * cell measurable, so the tile can ask for "as wide as 16:9 allows at this height" and stop
       * being a full-height box with a band of video in the middle. That band was where the name and
       * the mute badge ended up: anchored to the bottom of the cell, floating in empty space well
       * below the picture they belonged to.
       *
       * Unconditional now. It used to be skipped on a side dock, whose rows were sized from the
       * column width and would have collapsed to nothing under size containment — a shape a panel
       * can no longer be in, since every stage divides a box the user dragged.
       */
      /*
        The cell no longer measures itself: the box inside it does — see `tilePins`. A pinned
        spotlight is shorter than the cell it spans, and the picture has to be sized from the part
        that is on screen rather than from the whole scrollable column.
      */
      const cell: Record<string, string | number> = {};
      /*
        Solo hides the others rather than dropping them from the list.

        `tiles` is a reference-keyed `$each`, so removing an entry unmounts its row and takes the
        `<video>` with it — everyone's picture would go black on the way in and have to renegotiate
        on the way out. Hidden, they keep their streams and come back instantly.
      */
      const hidden: Record<string, string | number> = { display: 'none' };
      return tiles().map((entry) => {
        if (entry.id === focus) return { id: entry.id, style: { ...cell, ...(focus ? spotlight : {}) } };
        return { id: entry.id, style: focus !== null && solo() ? hidden : cell };
      });
    },
    /**
     * The box inside each tile that the picture is measured against.
     *
     * Ordinarily it simply fills the cell, and the picture sizes itself from it exactly as it did
     * when the cell was the container. The one that matters is the spotlight's while the strip
     * scrolls: it spans every row of a column taller than the stage, so a picture measured from the
     * cell would be sized for a box mostly off screen. Pinning this box to the visible band and
     * measuring *it* is what keeps the spotlight the size of what you can see.
     *
     * `position: sticky` rather than anything measured per frame: the browser holds it against the
     * scroll for free, and the height it is held at is the one number the stage already reports.
     */
    tilePins: (): { id: string; style: Record<string, string | number> }[] => {
      const focus = focusedId();
      const box = stageBox();
      const strip = stripLayout();
      const base: Record<string, string | number> = { 'container-type': 'size', width: '100%', height: '100%' };
      const pinned: Record<string, string | number> = strip.side
        ? { ...base, position: 'sticky', top: '0', height: `${Math.round(box.height)}px` }
        : { ...base, position: 'sticky', left: '0', width: `${Math.round(box.width)}px` };

      return tiles().map((entry) => ({
        id: entry.id,
        style: entry.id === focus && !solo() && strip.scroll ? pinned : base,
      }));
    },

    /**
     * Which way the stage scrolls, which is only ever the axis the strip runs along.
     *
     * Hidden on the other, because nothing should ever overflow it — the spotlight is fitted to the
     * box and the strip is one line. A stage that scrolled both ways would be hiding a bug rather
     * than offering a feature.
     */
    stageOverflow: (): Record<string, string> => {
      if (focusedId() === null || solo()) return { overflow: 'hidden' };
      const strip = stripLayout();
      if (!strip.scroll) return { overflow: 'hidden' };
      return strip.side
        ? { 'overflow-y': 'auto', 'overflow-x': 'hidden' }
        : { 'overflow-x': 'auto', 'overflow-y': 'hidden' };
    },

    /**
     * True when this agent is in a call — the call bar's visibility condition, and the key
     * `contributes.holds` names so the bar survives navigating to a space without calls.
     */
    active: state(() => callId() !== null, 'Whether this agent is in a call right now.'),

    /**
     * In a call that is happening somewhere other than the space on screen.
     *
     * The condition for the bar's way back, and it has to be a comparison rather than a flag: you
     * can leave the call's space and come back to it, and the affordance has to disappear again when
     * you do. `anchor.datasetUri` is set for every call — see `join`.
     */
    elsewhere: state(
      callIsElsewhere,
      'Whether the call this agent is in belongs to a space other than the one on screen.',
    ),

    /**
     * The space this call is in, named — or `null` when there is no call.
     *
     * Read through the host's dataset directory rather than remembered at join time, so a name or
     * picture that loads afterwards appears on its own. The uri is always there; the rest is
     * whatever the host knows, and a space whose record has not arrived yet simply has no name to
     * show, which the bar handles.
     */
    callSpace: state(() => {
      const uri = anchor?.datasetUri;
      if (!callId() || !uri) return null;
      const known = datasets?.get(uri);
      return { uri, name: known?.name ?? '', avatar: known?.avatar ?? '' };
    }, 'The space the call is in as { uri, name, avatar } — name and avatar empty until the host knows them — or null between calls.'),

    /** Go back to the space the call is in. No-op outside a call. */
    returnToCall: action(returnToCall, 'Go back to the space the call is in; does nothing outside a call.'),

    /**
     * The band this module's fixed chrome occupies, for panels to keep clear of.
     *
     * The bar is `position: fixed` at the top and paints above the panels, so a panel snapped to the
     * top centre lands underneath it — including the panel's own grip and position menu, which are
     * the two things it is dragged back out with. The host reserves this on every *floating* panel;
     * a displacing one is unaffected, since it takes an edge this does not sit on.
     *
     * Reported rather than assumed, because the host cannot see whether the bar is up: the same
     * value used to be a constant in the shell's geometry, reserving the band whether or not a call
     * was running, and it could not grow when another module contributed into this bar's column.
     *
     * Non-zero whenever the bar is drawn at all, which includes the join prompt shown to somebody
     * who is not in the call yet — that is the same object in the same place, so it takes the same
     * room. `CALL_BAR_TOP` plus a row of `md` controls in a padded surface.
     */
    chromeReserve: () =>
      callId() !== null || ongoingPeers().length > 0 ? { bottom: CALL_BAR_RESERVE_PX } : { bottom: 0 },

    /**
     * The microphone this call is sending, for a module that wants to listen to it.
     *
     * Reached through the `media` kernel — `media.input()` — rather than off this store: every write
     * to this signal is also a `media.publish`, so the host routes it without the two modules knowing
     * about each other. Kept on the store, unmarked, for this module's own chrome and its tests; a
     * template has no business with a `MediaStream`. The live stream rather than a copy,
     * deliberately: muting disables the track rather than removing it, so a listener receives
     * silence and stops producing — which is what makes "mute the call" also mean "stop
     * transcribing", with no coordination between the two and no way for them to disagree.
     */
    localAudio,

    /**
     * True where a call could actually be started.
     *
     * A personal space has no neighbourhood and therefore no transport, so there is nobody to call.
     * Offering the button anyway and explaining the failure afterwards is worse than not offering it:
     * the answer never changes, so it is not a failure, it is a property of the space.
     */
    canCall: state(
      () => (datasetUri?.() ?? null) !== null,
      'Whether a call could be started here — false in a personal space, which has nobody to call.',
    ),
    ongoing: state(
      ongoingPeers,
      'Everyone in any call in the space on screen, as avatar faces { image, hash, initials, did }, whether or not this agent has joined.',
    ),

    // ── Actions ──────────────────────────────────────────────────────────────

    /**
     * The rail's call button, in every state it can be pressed in. One promise: *go to the call.*
     *
     * The launcher used to be a bare join outright, which made it three different things
     * depending on what you were already doing, two of them wrong:
     *
     * - In this space's call, `join` returns early on the matching id — so the button was silently
     *   dead. Nothing in permanent chrome should absorb a click and do nothing.
     * - In an anchored call, or a call in another space, the ids differ — so it **tore that call
     *   down** and started a new one, with no confirmation. A rail button is pressed by accident;
     *   ending a live conversation is not something it should be able to do.
     *
     * So this never calls `join` while a call is running. What is left is the reading that holds in
     * all three states — bring me to the call — and it costs nothing when there is no call, because
     * starting one is how you get to it.
     *
     * Switching between calls is still expressible; it just is not this button. `joinCall` and
     * `joinAnchoredCall` keep their replace-the-current-call semantics for the template controls that
     * mean it — a card's Continue, a post's call button — where the target is named and the intent
     * is explicit.
     *
     * ## It shows, and never hides
     *
     * This toggled the stage once, on the reasoning that a rail button is a tab and a tab's second
     * press closes what the first opened. It made a liar of every control that calls it: the button
     * says *go to the call* and hiding the video is the opposite of going to it, so pressing the lit
     * rail tab — or a card's button — put the call away. Reported within a day of shipping, from a
     * calls list, which is exactly where it reads worst.
     *
     * "Go to" is a direction, so this is idempotent the way every other navigation is: pressing Home
     * while on Home does nothing and surprises nobody. Putting the video away is a real thing to
     * want and has two controls of its own — the panel's close button, and Video in the call bar —
     * neither of which is named after going somewhere.
     */
    goToCall: action(() => {
      if (!callId()) {
        // Join whatever is already running here rather than starting a second one beside it. With
        // one call per space this was the same act; now that it is not, a launcher that always
        // started a new call would split a meeting in two every time somebody arrived late.
        const ongoing = liveCalls()[0];
        if (ongoing) {
          void join(ongoing.id, undefined, ongoing.recordId ?? undefined);
          return;
        }
        /*
          Pick up the call the reader is looking at, rather than opening a fresh one beside it.

          On a template built around one conversation — the workshop's `?call=` — pressing the rail
          took you *out* of the meeting you were plainly in and started another, which is the one
          reading of "start a call" nobody wants while a call is on screen. The address is what
          knows; the host publishes it, because a module has no route access and a value a template
          sets on a click does not survive the refresh this is most needed after.

          Only in this branch, and that is the safety gate rather than an accident of placement.
          Continuing a past call *while another is running* tears the live one down and re-points
          every peer's transcript at the old record, since peers adopt an announced record over
          their own. Both branches above have already ruled that out: something is running, so
          "go to the call" can only mean the one that is.
        */
        const onScreen = callOnScreen?.();
        if (onScreen) {
          void continueCall(onScreen);
          return;
        }
        void startCall();
        return;
      }
      // The call is somewhere else: take the user to it, and show it when they land. `returnToCall`
      // is left alone to be pure navigation — it is the bar's button, and the bar is already in the
      // call, so it has no business deciding whether the video is up.
      if (callIsElsewhere()) {
        setVisible(true);
        returnToCall();
        return;
      }
      // In the call, here. Nowhere to travel to, so the whole of "go to it" is having it on screen.
      setVisible(true);
    }, 'Go to the call: join the one running here, pick up the one on screen, or start one; in a call already, bring it up.'),

    /** Start a new call here, whether or not one is already running. Resolves once it is joined. */
    startCall: action(
      (anchorNodeId?: string) => startCall(anchorNodeId),
      'Start a new call in the space on screen, optionally about the record whose id is given; resolves once joined.',
    ),

    /**
     * Pick a past call back up: start one on the record it already has, writing nothing new.
     *
     * What "continue this call" needs and `goToCall` cannot give it — that verb is a *direction*, so
     * with nothing running it starts a fresh call, which is right for a launcher and wrong for a row
     * naming the meeting it means.
     */
    continueCall: action(
      (recordId: string) => continueCall(recordId),
      'Pick a past call back up by its record id, joining anyone already in it and writing no new record.',
    ),

    /** Join a call somebody else started, by the id the roster carries. */
    joinCall: action((id: string) => {
      if (!id) return;
      const ongoing = liveCalls().find((call) => call.id === id);
      void join(id, undefined, ongoing?.recordId ?? undefined);
    }, 'Join a running call by its id, as liveCalls lists it, leaving any call this agent is in.'),

    /**
     * Point an in-progress call at a node, without rejoining it.
     *
     * For the case where a call starts loose and turns out to be *about* something — someone opens
     * the post they are discussing, and from then on the transcript should belong to it.
     *
     * Emphatically not a re-join, and not a change of call id. The mesh reconciles against the roster
     * keyed by call id, so promoting `space:<uri>` to `node:<uri>:<id>` mid-call would read as every
     * peer leaving one call and joining another: every connection torn down and rebuilt, and the
     * media with it. The id stays; only what the call says it is about changes.
     */
    attachAnchor: action((nodeId: string) => {
      const uri = datasetUri?.() ?? null;
      if (!callId() || !uri || !nodeId) return;
      anchor = { datasetUri: uri, nodeId };
      publishActivity();
    }, 'Make the running call about the record whose id is given, without rejoining it.'),

    /**
     * "Call on this post" — join the call already happening about that node, or start one.
     *
     * A node can now host several calls over its life, and more than one at a time, because the id
     * is the call's own record rather than the node's. What it must not do is start a *second* call
     * on a post while one is running, which is what pressing the same button twice used to be safe
     * from only because the derived id made it the same call.
     */
    joinAnchoredCall: action((nodeId: string) => {
      if (!nodeId) {
        setProblem('A call needs a space and something to anchor to.');
        return;
      }
      const ongoing = liveCalls().find((call) => call.anchorNodeId === nodeId);
      if (ongoing) {
        void join(ongoing.id, undefined, ongoing.recordId ?? undefined);
        return;
      }
      void startCall(nodeId);
    }, 'Join the call already happening about the record whose id is given, or start one about it.'),

    leave: action(teardown, 'Leave the call, releasing the camera, the microphone and every connection.'),

    toggleAudio: action(
      () => controller?.setAudioEnabled(!media().audioEnabled),
      'Mute or unmute this agent’s microphone.',
    ),
    /**
     * Turn the camera on or off — and say so when it refuses.
     *
     * Asked on the outcome rather than caught from an error, which keeps this free of matching on
     * message text: wanting the camera and not having it afterwards is the whole condition. Until
     * this, a refusal reached the console and nowhere else, so the button appeared to do nothing.
     */
    toggleVideo: action(async () => {
      const wanted = !media().videoEnabled;
      await controller?.setVideoEnabled(wanted);
      if (wanted && !controller?.state().videoEnabled) setProblem(CAMERA_BLOCKED);
    }, 'Turn this agent’s camera on or off, reporting through problem when it is refused.'),
    /**
     * Send a different microphone or camera, in a call or before one.
     *
     * Remembered on this machine either way — the choice outlives the call, which is the whole point
     * of choosing rather than being assigned. In a call it takes effect at once, without
     * renegotiating: `replaceTrack` is the same path screen share has always used.
     *
     * The choice is written before the switch is attempted and kept even when the switch fails, so a
     * device that is momentarily busy — another app holding it, a hub waking up — is still the one
     * asked for next time rather than being forgotten because of one refusal. What a failure costs
     * is that the call carries on with the previous device, which is stated by the switch answering
     * `false` and by nothing appearing to change.
     *
     * An empty id is "whatever the system offers", which is how a chooser goes back to no opinion.
     */
    setDevice: action(async (kind: DeviceKind, deviceId: string) => {
      writeChosenDevice(kind, deviceId);
      if (kind === 'audio') setAudioDeviceId(deviceId);
      else setVideoDeviceId(deviceId);
      await controller?.setDevice(kind, deviceId);
      // Names may have arrived with the first grant this switch triggered.
      void refreshDevices();
    }, 'Use a different microphone or camera; an empty id means whatever the system offers.'),
    /**
     * Ask the machine what it has to capture with.
     *
     * Called by a chooser as it opens rather than held permanently up to date, because enumerating
     * is a question for the host and most of the app never asks it. The list keeps itself current
     * from then on — the store watches for hardware moving.
     */
    refreshDevices: action(() => void refreshDevices(), 'Re-read which microphones and cameras this machine has.'),
    /**
     * Open the chooser, and ask what is here on the way in.
     *
     * The refresh is the point of pairing them: a list gathered when the module was constructed is
     * a list from before anything was plugged in, and the moment somebody opens a chooser is the
     * moment it has to be true.
     */
    openDeviceSettings: action(() => {
      void refreshDevices();
      setDeviceSettingsOpen(true);
    }, 'Open the camera and microphone chooser.'),
    closeDeviceSettings: action(() => setDeviceSettingsOpen(false), 'Close the camera and microphone chooser.'),
    /**
     * Ask for a device once, purely so the machine will say what its hardware is called.
     *
     * Labels are withheld until capture has been allowed at least once — a page that could read them
     * without asking could fingerprint a machine by its hardware. So a chooser opened before any
     * call has ever run shows numbered devices and nothing else, and this is the way out of that:
     * acquire, learn the names, and let go again immediately.
     *
     * Only outside a call. In one the devices are already open and the names are already known, and
     * a second acquisition would be a second camera light for no reason.
     */
    nameDevices: action(async () => {
      if (callId() || !mediaKernel) return;
      try {
        const probe = await mediaKernel.getUserMedia({ audio: true, video: true });
        for (const track of probe.getTracks()) track.stop();
      } catch {
        // Refused, or no such device. Still a probe: we asked, and what came back — nothing, or a
        // refusal — is now a fact about this machine rather than a question nobody had put.
      }
      setDevicesProbed(true);
      void refreshDevices();
    }, 'Ask for a device once so this machine will say what its hardware is called.'),
    toggleScreenShare: action(async () => {
      if (media().screenShareEnabled) {
        controller?.stopScreenShare();
        return;
      }
      // Only a genuine failure is worth a message. Closing the picker is an answer, not a fault.
      if ((await controller?.startScreenShare()) === 'failed') setProblem(SCREEN_UNAVAILABLE);
    }, 'Start or stop sharing this agent’s screen; sharing replaces the camera until it stops.'),
    /**
     * Show the video, or put it away. The other half of what one button used to do alone.
     *
     * Unmarked, with `closeStage` and `openStage`: the panel declaration names two of them and the
     * bar's Video toggle calls the third, all at chrome tier. A space template opens the stage by
     * declaring the panel in its `meta.panels`, which is the host's door, not this one.
     */
    toggleStage: () => setVisible(!visible()),
    /** Put the video away. The panel declaration's `close`, so the titlebar has a way to dismiss it. */
    closeStage: () => setVisible(false),

    /**
     * Give this participant the stage, or take it back if they already have it.
     *
     * Marks the focus as the user's, which is what stops a running screen share from reclaiming it
     * on the next heartbeat. Clearing focus counts as a choice too — "show me everyone" is an
     * instruction, not an absence of one.
     */
    focusTile: action((id: string) => {
      const next = focusedId() === id ? null : id;
      focusIsManual = true;
      setFocusedId(next);
      // Letting everyone back on the stage ends solo with it: it is a property of *having* a
      // spotlight, and a mode left armed with nothing to apply to would take effect on whoever was
      // focused next, which nobody asked for.
      if (next === null) setSolo(false);
      // The states array carries `focused`, so the change has to reach it for the layout to move.
      rebuildTiles();
    }, 'Give the participant with this id the spotlight, or take it back if they already have it.'),

    /**
     * Give the spotlight the stage to itself, or bring the others back.
     *
     * Only meaningful while something is focused, and the bar only shows it then — but guarded here
     * too, since a store method is reachable by anything a template can write.
     */
    toggleSolo: action(() => {
      if (focusedId() === null) return;
      setSolo(!solo());
    }, 'Hide everyone but the spotlight, or bring them back; does nothing while nobody is focused.'),

    dismissProblem: action(() => setProblem(null), 'Dismiss the problem message.'),

    /**
     * Build this one peer's connection again, and tell them to do the same.
     *
     * The manual rung of the mesh's recovery ladder, for a button on the tile that is broken.
     *
     * Its existence is an admission as much as a feature: everything above it is the app repairing
     * itself, and this is what is left when that has not worked. The alternative people were left
     * with was leaving the call and rejoining, which takes everyone's picture down to fix one
     * pair — and, because a call's roster is presence, briefly tells the whole room you left.
     *
     * Deliberately not gated on the pair looking broken. Whether a connection is "bad enough" is a
     * judgement the person watching it makes better than `connectionState` does: a pair can be
     * `connected` and useless, and refusing them the button in that state would be the app insisting
     * that what they are looking at is fine.
     */
    reconnectPeer: action((id: string) => {
      if (!id || !mesh) return;
      // Your own tile is not a connection, and a synthetic one is not a peer. Both would be no-ops
      // in the mesh; refusing here keeps `retrying` from lighting up on a tile nothing will repair.
      if (id === (selfId?.() ?? null)) return;
      recovering.set(id, { rung: 'rebuild', attempts: 0 });
      transports.delete(id);
      mesh.reconnect(id);
      rebuildTiles();
    }, "Build one peer's connection again from scratch, without leaving the call."),
  };
}
