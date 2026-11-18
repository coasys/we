/**
 * Local media — the microphone, the camera, and the screen.
 *
 * Split from the mesh because they fail differently and independently. Media fails *locally* and
 * loudly: a denied permission, a camera another app has already claimed. Signalling fails *between*
 * peers. Tangling them produces the bug where one peer's refused camera prompt tears down everyone's
 * audio.
 *
 * ## How screen share is modelled — and its one real limitation
 *
 * Sharing **replaces** the outbound video track rather than adding a second one. `replaceTrack` does
 * not renegotiate, so the swap is instant and cannot half-apply across peers.
 *
 * A receiver still needs to know a screen is a screen — a 16:9 desktop cropped to fill a square
 * camera tile is unreadable. That information is already travelling: presence publishes
 * `MediaSettings` on the call activity, so `screenShareEnabled` on the *roster* tells every peer how
 * to render the tile, with no extra protocol message and nothing to keep in sync.
 *
 * The limitation this buys: **you cannot send camera and screen at once.** Sharing turns the camera
 * off, and stopping the share turns it back on if it was on before. Simultaneous camera-plus-screen
 * needs a second transceiver *and* a way to tell the receiver which track is which — a real protocol
 * addition, not a tweak, and one worth making against a real complaint rather than speculatively.
 *
 * ## Mute is `enabled`, not a track swap
 *
 * Muting sets `track.enabled = false`, which keeps the sender in place and sends silence. Stopping
 * the track instead would free the device — the camera light would go out, which is arguably better
 * privacy — but it forces a renegotiation on every unmute and re-prompts on some platforms. Presence
 * carries the muted state as `MediaSettings`, so peers render a muted badge from the roster rather
 * than trying to infer it from the media.
 */
import { latest } from '@we/module-shared';

/** The browser APIs this controller needs, injected so tests need no browser. */
export interface MediaDeviceAccess {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  getDisplayMedia: (constraints?: DisplayMediaStreamOptions) => Promise<MediaStream>;
}

export interface MediaState {
  audioEnabled: boolean;
  videoEnabled: boolean;
  screenShareEnabled: boolean;
}

export interface MediaControllerOptions {
  devices?: MediaDeviceAccess;
  /** Called whenever the track a kind should be sending changes. The mesh subscribes to this. */
  onTrackChanged?: (kind: 'audio' | 'video', track: MediaStreamTrack | null) => void;
  /** Called when enabled-flags change, so presence can republish `MediaSettings`. */
  onStateChanged?: (state: MediaState) => void;
  /**
   * A device this agent was using has gone — unplugged, or taken by something else.
   *
   * Its own callback rather than an `onError`, because nothing failed and there is nothing to retry:
   * the hardware left. The state is already corrected by the time this fires; what the host does
   * with it is say so, since the alternative is a person who looks unmuted and is sending silence.
   */
  onDeviceLost?: (kind: 'audio' | 'video') => void;
  onError?: (context: string, error: unknown) => void;
}

export interface MediaController {
  /** This agent's own camera/mic stream, for the self-view tile. */
  localStream(): MediaStream | null;
  /** What the self-view should actually show — the screen while sharing. */
  displayStream(): MediaStream | null;
  state(): MediaState;
  /** Acquire mic and camera. Safe to call repeatedly; only the first acquires. */
  start(constraints?: MediaStreamConstraints): Promise<void>;
  /**
   * Send a different microphone or camera, without leaving the call.
   *
   * An empty id means "whatever the system offers", which is the state a chooser returns to rather
   * than a fourth kind of nothing.
   *
   * Answers whether the switch happened. `false` is a device that could not be opened — unplugged
   * between listing and choosing, or held exclusively by something else — and the previous one is
   * still running, because the new track is acquired before the old one is let go.
   */
  setDevice(kind: 'audio' | 'video', deviceId: string): Promise<boolean>;
  /** Mute or unmute — and, unmuting with no microphone, ask for one, as the camera does. */
  setAudioEnabled(enabled: boolean): Promise<void>;
  setVideoEnabled(enabled: boolean): Promise<void>;
  /**
   * Begin sharing a screen. Reports which of the three things happened, rather than only failing.
   *
   * `'cancelled'` is the user closing the picker, which is not a problem and must stay silent.
   * `'failed'` is the machine being unable to — no ScreenCast portal, no capture device — which is
   * worth saying out loud, because otherwise the button appears to do nothing at all.
   */
  startScreenShare(): Promise<'started' | 'cancelled' | 'failed'>;
  stopScreenShare(): void;
  /** Release every device. The camera light must go out when the call ends. */
  stop(): void;
}

const DEFAULT_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true },
  video: { width: { ideal: 1280 }, height: { ideal: 720 } },
};

export function createMediaController(options: MediaControllerOptions = {}): MediaController {
  const devices: MediaDeviceAccess = options.devices ?? {
    getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
    getDisplayMedia: (c) => navigator.mediaDevices.getDisplayMedia(c),
  };

  let stream: MediaStream | null = null;
  let screenStream: MediaStream | null = null;
  /** Whether the camera was on before sharing started, so stopping restores what the user had. */
  let videoBeforeShare = false;

  /**
   * Which acquisition attempt is current. Cancelled by `stop()`, checked by `start()` after every await.
   *
   * `getUserMedia` sits behind a permission prompt, so it can be outstanding for as long as the user
   * takes to answer. Leave the call — or join a different one — while that prompt is open and
   * `stop()` ran against a null stream and found nothing to close; the promise then resolved into a
   * live camera and microphone that nothing held a reference to.
   */
  const acquisitions = latest();

  /**
   * Tracks acquired but not yet owned by `stream`, parked where `stop()` can reach them.
   *
   * `start()` asks for the microphone and the camera one after the other, so while the camera
   * prompt is open the already-granted microphone lives only in a local variable — `stop()` could
   * not see it, and a leave kept it running until the prompt was answered, which can be never.
   * `stop()` stops everything parked here; ownership moves to `stream` the moment it is built.
   */
  const pending = new Set<MediaStreamTrack>();

  /**
   * The device request under way — `start`'s, an unmute's, a camera turned on, a device switch — or
   * none.
   *
   * `getUserMedia` sits behind the permission prompt, so an unmute, a camera or a switch can arrive
   * while another is already waiting. Each waits for this one to settle before it asks
   * ([`deviceTurn`]), which is what keeps "one microphone, one camera" true: two at once would
   * resolve into two live tracks, one of them in no stream `stop()` reaches, and a refusal of one
   * would mark the call muted over the other, still sending.
   */
  let pendingRequest: Promise<void> | null = null;

  /**
   * Which `setAudioEnabled` call is newest, so a request made for an earlier one knows a later ask
   * has happened. A refusal only mutes the state while it answers the latest ask — an earlier one
   * failing must not switch off the microphone a newer unmute is still getting.
   */
  let audioRequests = 0;

  const state: MediaState = { audioEnabled: true, videoEnabled: true, screenShareEnabled: false };

  const emitState = () => options.onStateChanged?.({ ...state });

  const cameraTrack = () => stream?.getVideoTracks()[0] ?? null;
  const micTrack = () => stream?.getAudioTracks()[0] ?? null;
  const screenTrack = () => screenStream?.getVideoTracks()[0] ?? null;

  /** The video track the mesh should be sending right now: the screen while sharing, else the camera. */
  const publishVideo = () =>
    options.onTrackChanged?.('video', state.screenShareEnabled ? screenTrack() : cameraTrack());

  /**
   * The audio counterpart of `publishVideo`. Muting keeps the sender and flips `enabled`; a device
   * switch replaces the track, so it has to be published again.
   */
  const publishAudio = () => options.onTrackChanged?.('audio', micTrack());

  /**
   * What was asked for last, so a later acquisition asks for the same thing — a camera re-acquired
   * after toggling video must be the chosen one, not the system default.
   */
  let asked: MediaStreamConstraints = DEFAULT_CONSTRAINTS;
  /** The device each kind has been pinned to, or empty for whatever the system offers. */
  const chosen: { audio: string; video: string } = { audio: '', video: '' };

  /**
   * One kind's constraints, with the chosen device pinned into them.
   *
   * `exact`, not `ideal`. A soft hint is advisory and browsers are free to ignore it, which would
   * make a picker that appears to work and does not; `exact` either opens the device the person
   * chose or fails, and failing is recoverable — the caller falls back and says so. A picker that
   * silently selects something else is the one outcome with no way back.
   */
  function constraintsFor(kind: 'audio' | 'video'): MediaTrackConstraints | boolean {
    const base = (kind === 'audio' ? asked.audio : asked.video) ?? true;
    const id = chosen[kind];
    if (!id) return base;
    return { ...(typeof base === 'object' ? base : {}), deviceId: { exact: id } };
  }

  /**
   * A local track that stops existing, rather than one this agent turned off.
   *
   * ## What went wrong without it
   *
   * Nothing watched the camera or microphone this agent was *sending*. Only remote tracks were
   * watched (for the frozen-tile case) and the screen track (for the browser's own "Stop sharing"
   * bar). So unplugging a USB headset mid-call ended the track and nothing else changed at all:
   * `audioEnabled` stayed true, presence went on publishing `audioEnabled: true`, and every peer's
   * roster showed this agent unmuted while they sent silence. No error, nothing on screen, and no
   * way for the person to discover it except by being told.
   *
   * It is the same shape as the bug `setVideoEnabled` describes — "the flag was the only thing that
   * changed … nothing could ever resolve it" — for a cause that code never anticipated.
   *
   * ## Why `ended` and not `mute`
   *
   * `ended` is the source going away for good, which is the case worth acting on. `mute` on a local
   * track is the source temporarily unable to produce — another application taking exclusive access,
   * an OS-level mute — and it comes back, so treating it as loss would turn a hiccup into a state
   * the person has to undo by hand. Worth revisiting if a browser turns out to report a real unplug
   * that way.
   *
   * Calling `track.stop()` does **not** fire this: the spec fires `ended` for the source ending, not
   * for the consumer letting go. So `stop()`, `stopScreenShare` and a deliberate device switch are
   * all silent here, which is what makes one listener safe to attach for the life of the track.
   */
  function watchForLoss(track: MediaStreamTrack, kind: 'audio' | 'video') {
    track.addEventListener('ended', () => {
      // Only if it is still the track being sent. A device switched away from is stopped rather than
      // ended, but a track that lost a race to a switch must not correct state about its successor.
      if (!stream?.getTracks().includes(track)) return;
      stream.removeTrack(track);

      /*
        The state is corrected to what is true, which is what this file does everywhere else: nothing
        is being sent, so the flag says so and presence republishes it. A person reading their own
        bar sees themselves muted, which is the honest reading — and the host says why.
      */
      if (kind === 'audio') {
        state.audioEnabled = false;
        options.onTrackChanged?.('audio', null);
      } else {
        state.videoEnabled = false;
        // Not while sharing: the screen is what is being sent, and the camera going is not visible
        // to anyone. `publishVideo` already picks the right one.
        publishVideo();
      }

      options.onDeviceLost?.(kind);
      emitState();
    });
  }

  /**
   * One kind on its own — the microphone or the camera — or `null` when it is refused or missing.
   *
   * The refusal is reported under the same context the rest of this file uses for that device, and
   * a stream that arrives without a track of the kind asked for is closed rather than kept.
   */
  async function acquireAlone(kind: 'audio' | 'video'): Promise<MediaStreamTrack | null> {
    let alone: MediaStream;
    try {
      alone = await devices.getUserMedia(
        kind === 'audio' ? { audio: constraintsFor('audio') } : { video: constraintsFor('video') },
      );
    } catch (error) {
      options.onError?.(kind === 'audio' ? 'acquiring microphone' : 'acquiring camera', error);
      return null;
    }
    const track = (kind === 'audio' ? alone.getAudioTracks() : alone.getVideoTracks())[0] ?? null;
    for (const other of alone.getTracks()) if (other !== track) other.stop();
    return track;
  }

  /**
   * Runs `work`, a device request, once no other is under way, as `pendingRequest`.
   *
   * The guard is taken where the work is queued rather than inside it: `acquisitions.current()`
   * asked after `stop()` answers for the new generation and always passes, which is how a queued
   * unmute used to adopt a microphone for a call that had already left. Stale work is never
   * dispatched — `undefined` says it did not run.
   */
  async function deviceTurn<T>(work: () => Promise<T>): Promise<T | undefined> {
    const isMine = acquisitions.current();
    while (pendingRequest) await pendingRequest;
    if (!isMine()) return undefined;
    const run = work();
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    pendingRequest = settled;
    try {
      return await run;
    } finally {
      if (pendingRequest === settled) pendingRequest = null;
    }
  }

  /**
   * Get a microphone for an unmute that has none, and adopt it. Run through [`deviceTurn`].
   *
   * What the track does when it lands is decided by `state.audioEnabled` *then*, not by who asked
   * first: a mute that arrived while the prompt was open keeps the microphone it raced, but silent —
   * the same state as muting a live track, so a later unmute only re-enables.
   */
  async function acquireMic(request: number): Promise<void> {
    const isMine = acquisitions.current();
    let acquired: MediaStream;
    try {
      acquired = await devices.getUserMedia({ audio: constraintsFor('audio') });
    } catch (error) {
      options.onError?.('turning the microphone on', error);
      // Only the latest ask may write the state back — a later `setAudioEnabled` owns it now.
      if (!isMine() || request !== audioRequests) return;
      state.audioEnabled = false;
      emitState();
      return;
    }

    const track = acquired.getAudioTracks()[0] ?? null;
    for (const other of acquired.getTracks()) if (other !== track || !isMine()) other.stop();
    if (!isMine() || !track) {
      if (isMine() && request === audioRequests) {
        state.audioEnabled = false;
        emitState();
      }
      return;
    }

    // A new stream rather than `addTrack` on the old one, for `setDevice`'s reason: the transcriber
    // listens to the stream it was handed and dedupes on identity, so a microphone added in place
    // would be sent to peers and heard by nothing local.
    stream = new MediaStream([...(stream?.getTracks() ?? []), track]);
    track.enabled = state.audioEnabled;
    watchForLoss(track, 'audio');
    publishAudio();
    emitState();
  }

  /**
   * Get a camera for a call that has none, and adopt it. Run through [`deviceTurn`]. `true` when the
   * call now has one; the caller then sets the flag as it would for a camera already there.
   */
  async function acquireCamera(): Promise<boolean> {
    const isMine = acquisitions.current();
    let acquired: MediaStream;
    try {
      // What was asked for at `start`, with whatever camera has been chosen since — not
      // `DEFAULT_CONSTRAINTS`, which would revert a chosen camera to the system default.
      acquired = await devices.getUserMedia({ video: constraintsFor('video') });
    } catch (error) {
      // Still refused. The flag goes back off rather than staying true with nothing behind it,
      // which is the state that could not be recovered from.
      options.onError?.('turning the camera on', error);
      if (!isMine()) return false;
      state.videoEnabled = false;
      emitState();
      return false;
    }

    const track = acquired.getVideoTracks()[0] ?? null;
    if (!isMine() || !track) {
      for (const orphan of acquired.getTracks()) orphan.stop();
      if (isMine()) {
        state.videoEnabled = false;
        emitState();
      }
      return false;
    }

    // Merged into the stream already being sent rather than replacing it, so the microphone
    // acquired earlier keeps running — and so `stop()` still closes everything from one place.
    if (stream) stream.addTrack(track);
    else stream = acquired;
    // The camera acquired here is as losable as the one acquired at `start` — see `watchForLoss`.
    watchForLoss(track, 'video');
    publishVideo();
    return true;
  }

  /** The work of `setDevice`: open the chosen device, then let the old one go. */
  async function replaceDevice(kind: 'audio' | 'video'): Promise<boolean> {
    // Nothing is open yet — the choice is remembered and `start` will ask for it. This is the
    // ordinary path when somebody picks a device before joining.
    if (!stream) return true;

    const isMine = acquisitions.current();
    let acquired: MediaStream;
    try {
      acquired = await devices.getUserMedia(
        kind === 'audio' ? { audio: constraintsFor('audio') } : { video: constraintsFor('video') },
      );
    } catch (error) {
      options.onError?.(`switching ${kind === 'audio' ? 'microphone' : 'camera'}`, error);
      return false;
    }

    const next = (kind === 'audio' ? acquired.getAudioTracks() : acquired.getVideoTracks())[0] ?? null;
    // Cancelled while the prompt was open, or a device that opened with nothing in it. Either way
    // what was acquired belongs to nobody — the check is `start`'s, for its reason.
    if (!isMine() || !next) {
      for (const orphan of acquired.getTracks()) orphan.stop();
      return false;
    }

    const replaced = kind === 'audio' ? stream.getAudioTracks() : stream.getVideoTracks();
    const kept = stream.getTracks().filter((track) => !replaced.includes(track));
    for (const old of replaced) old.stop();

    next.enabled = kind === 'audio' ? state.audioEnabled : state.videoEnabled;
    watchForLoss(next, kind);
    stream = new MediaStream([...kept, next]);

    if (kind === 'audio') publishAudio();
    else publishVideo();
    emitState();
    return true;
  }

  function stopScreenShare() {
    if (!screenStream) return;
    for (const track of screenStream.getTracks()) track.stop();
    screenStream = null;
    state.screenShareEnabled = false;
    // Restore whatever the camera was doing before, rather than assuming it should come back on —
    // and only as far as there is a camera to restore. Without that second condition, stopping a
    // share started from a call with no camera left `videoEnabled: true` with no track behind it,
    // which is the stuck-on-Connecting state by another route.
    state.videoEnabled = videoBeforeShare && !!cameraTrack();
    const camera = cameraTrack();
    if (camera) camera.enabled = videoBeforeShare;
    publishVideo();
    emitState();
  }

  return {
    localStream: () => stream,
    displayStream: () => screenStream ?? stream,
    state: () => ({ ...state }),

    async start(constraints = DEFAULT_CONSTRAINTS) {
      if (stream) return;
      // Remembered, so every later acquisition asks for the same thing — see `asked`.
      asked = constraints;
      const isMine = acquisitions.begin();
      // A `setAudioEnabled` after this owns the microphone state: a refusal here must not mute over it.
      const audioAsk = audioRequests;
      /** Close a stream that arrived after this attempt was cancelled, rather than storing it. */
      const claim = (acquired: MediaStream): boolean => {
        if (isMine()) return true;
        for (const track of acquired.getTracks()) track.stop();
        return false;
      };

      /*
        A device request like an unmute's, a camera's or a switch's, so it takes the device turn: an
        unmute or a camera pressed while the prompt is open waits for this to settle and adopts what
        it got, rather than opening a second request beside it — one whose track `stream` would
        orphan when this lands, and `stop()` could not reach.
      */
      await deviceTurn(async () => {
        let acquired: MediaStream;
        try {
          // Through `constraintsFor`, not the argument as given, so a device chosen *before* joining
          // is asked for on the first acquisition rather than only on a later switch. That is the
          // ordinary path: the choice is made once in settings and every call after it uses it.
          acquired = await devices.getUserMedia({ audio: constraintsFor('audio'), video: constraintsFor('video') });
        } catch (error) {
          /*
            A refused or missing device must not take the other one with it — audio-only and
            video-only are both valid ways to be in a call. So each kind is asked for alone, and
            whichever the device grants is kept.

            Only audio used to be retried, so a refused *microphone* lost the camera too: a phone whose
            app had no microphone permission joined with neither, though its camera was there to be had.
          */
          options.onError?.('acquiring camera and microphone', error);
          if (!isMine()) return;
          // One after the other rather than together: two permission prompts at once is a race some
          // platforms lose. Each is checked against `isMine`, since either can sit on a prompt.
          const mic = await acquireAlone('audio');
          if (!isMine()) return void mic?.stop();
          // Parked where `stop()` can reach it for as long as it is held only in this local — a
          // leave while the camera prompt is still open must put the microphone out at once, not
          // whenever the prompt happens to be answered.
          if (mic) pending.add(mic);
          const camera = await acquireAlone('video');
          if (mic) pending.delete(mic);
          if (!isMine()) {
            mic?.stop();
            camera?.stop();
            return;
          }
          if (!mic && !camera) {
            /*
              Nothing was acquired — and saying so is the whole of this branch.

              Denying the prompt denies the *request*, so the retries are refused too without
              prompting again. This used to return here, leaving `state` claiming `videoEnabled: true`
              and never calling `emitState()`. Both consequences were visible and neither was
              recoverable: the self tile had already been built with "wants a picture, has none" and so
              sat on **Connecting…** for the rest of the call, and `publishActivity` had already told
              every peer `videoEnabled: true`, so their tile for this agent sat on it too.

              The state is corrected to what is true — nothing is being sent — and emitted, which is
              what republishes presence and rebuilds the tiles.
            */
            state.videoEnabled = false;
            if (audioAsk === audioRequests) state.audioEnabled = false;
            emitState();
            return;
          }
          // Whichever is missing is off, for the same reason: never "on" with nothing behind it.
          if (!mic && audioAsk === audioRequests) state.audioEnabled = false;
          if (!camera) state.videoEnabled = false;
          acquired = new MediaStream([mic, camera].filter((track): track is MediaStreamTrack => !!track));
        }
        if (!claim(acquired)) return;
        stream = acquired;

        for (const track of stream.getAudioTracks()) {
          track.enabled = state.audioEnabled;
          watchForLoss(track, 'audio');
        }
        for (const track of stream.getVideoTracks()) {
          track.enabled = state.videoEnabled;
          watchForLoss(track, 'video');
        }

        options.onTrackChanged?.('audio', stream.getAudioTracks()[0] ?? null);
        publishVideo();
        emitState();
      });
    },

    /**
     * Send a different microphone or camera, mid-call, without renegotiating.
     *
     * ## The swap itself is free; the identity is the part that matters
     *
     * `replaceTrack` does not renegotiate, so the far end sees the new device with no protocol
     * round trip — the same path screen share has always used. What is *not* free is telling
     * everything downstream, and the trap is on the audio side.
     *
     * The stream this controller holds is shared: the store publishes it through `media.publish`, and
     * the transcriber reads it with `media.input()` and builds an audio graph from it. That store's
     * setter dedupes on the stream's identity — deliberately, so a mute does not re-announce the same
     * capture. Mutating the tracks of the existing stream would therefore change what is being sent
     * and tell nobody: the transcriber would go on listening to the microphone that had just been
     * unplugged from the graph, transcribing silence, with nothing anywhere saying why.
     *
     * So a switch builds a **new** `MediaStream`. Identity changing is the message.
     *
     * ## Acquire, then let go
     *
     * The new device is opened before the old one is stopped, so a device that cannot be opened —
     * unplugged between listing and choosing, or held exclusively by another application — leaves
     * the call exactly as it was rather than silent. The cost is that a machine which only permits
     * one consumer of a device refuses the second open; that is the rarer failure and the recoverable
     * one, where stopping first and failing to reacquire is neither.
     */
    async setDevice(kind, deviceId) {
      chosen[kind] = deviceId;
      // A switch is a device request: one at a time with an unmute's or a camera's, so the two never
      // resolve into two live devices, and the other adopts the one the switch got. A switch queued
      // behind a leave never ran, which answers `false`: no switch happened.
      return (await deviceTurn(() => replaceDevice(kind))) ?? false;
    },

    async setAudioEnabled(enabled) {
      /*
        Unmuting when there is no microphone means *getting* one — the camera's rule in
        `setVideoEnabled`, which audio never had. Join with the microphone refused and this only
        flipped a flag on a track that was not there: the button said unmuted, presence told every
        peer the same, and nothing ever asked for a microphone again, so audio never came back.

        The flag is recorded before the wait, not after it: it is what an acquisition reads when its
        track lands, so a mute that arrives while the prompt is open wins over the unmute that
        started it — the landed track is kept, but silent. An unmute while a microphone is being
        acquired (another unmute's, or a switch's) waits for it and adopts what it got, asking again
        only if it got nothing. The tracks then take the flag as it stands after the wait.
      */
      state.audioEnabled = enabled;
      const request = ++audioRequests;
      // Captured before the wait: a leave while this is queued or prompting must stop both the
      // dispatch (`deviceTurn` checks it again there) and the publish below.
      const isMine = acquisitions.current();
      if (enabled && (pendingRequest || !micTrack())) {
        await deviceTurn(() => (micTrack() ? Promise.resolve() : acquireMic(request)));
      }
      if (!isMine()) return;

      for (const track of stream?.getAudioTracks() ?? []) track.enabled = state.audioEnabled;
      emitState();
    },

    async setVideoEnabled(enabled) {
      // While sharing, the camera is not what is being sent — remember the preference and apply it
      // when the share stops, rather than silently doing nothing.
      videoBeforeShare = enabled;

      /*
        Turning the camera on when there is no camera means *getting* one. Setting the flag alone,
        with no track behind it, leaves every tile for this agent on **Connecting…** with nothing
        that would ever resolve it.

        Asking again is also the right behaviour on its own terms. "We failed once" is not an answer
        to someone pressing the camera button: the usual reason they are pressing it is that they
        have just changed the permission.
      */
      if (enabled && !state.screenShareEnabled && (pendingRequest || !cameraTrack())) {
        // In the device turn, so a camera pressed while `start` or a switch is prompting adopts what
        // that got rather than opening a second one. It asks only if there is still none after.
        const got = await deviceTurn(() => (cameraTrack() ? Promise.resolve(true) : acquireCamera()));
        // Refused, or the call left (the turn never ran it, or `acquireCamera` dropped what it got):
        // nothing to switch on, and `acquireCamera` has already set the state of a refusal.
        if (!got) return;
      }

      state.videoEnabled = enabled;
      if (!state.screenShareEnabled) {
        const camera = cameraTrack();
        if (camera) camera.enabled = enabled;
      }
      emitState();
    },

    async startScreenShare() {
      if (state.screenShareEnabled) return 'started';
      try {
        screenStream = await devices.getDisplayMedia({ video: true });
      } catch (error) {
        options.onError?.('starting screen share', error);
        /*
          Two very different outcomes arrive down this one path, and treating them alike meant a
          machine that *cannot* share a screen behaved exactly like a user who changed their mind:
          nothing happened and nothing was said.

          The spec gives the user's own refusal — closing the picker — as `NotAllowedError`, and
          everything else to the machine: no capture device, no portal, an unsatisfiable constraint.
          On a Linux desktop with no `org.freedesktop.portal.ScreenCast` interface, WebKitGTK reports
          `OverconstrainedError`, which is a strange name for "there is nothing here to capture" but
          is unambiguously not the user declining.
        */
        const declined = error instanceof Error && error.name === 'NotAllowedError';
        return declined ? 'cancelled' : 'failed';
      }

      videoBeforeShare = state.videoEnabled;
      state.screenShareEnabled = true;
      state.videoEnabled = false;

      // The browser's own "Stop sharing" bar ends the track without telling us. Without this the UI
      // would keep claiming to share a screen that is no longer being captured.
      const track = screenTrack();
      track?.addEventListener('ended', () => stopScreenShare());

      publishVideo();
      emitState();
      return 'started';
    },

    stopScreenShare,

    stop() {
      // Before closing anything: an acquisition still waiting on the permission prompt has to learn
      // it has been cancelled, or it resolves into a device this call no longer owns.
      acquisitions.cancel();
      // Tracks acquired but not yet owned by `stream` — the fallback's microphone while the
      // camera prompt is still open — are parked in `pending` for exactly this.
      for (const track of pending) track.stop();
      pending.clear();
      for (const track of stream?.getTracks() ?? []) track.stop();
      for (const track of screenStream?.getTracks() ?? []) track.stop();
      stream = null;
      screenStream = null;
      state.screenShareEnabled = false;
      options.onTrackChanged?.('audio', null);
      options.onTrackChanged?.('video', null);
      emitState();
    },
  };
}
