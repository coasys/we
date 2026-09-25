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
  setAudioEnabled(enabled: boolean): void;
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
   * Which acquisition attempt is current. Bumped by `stop()`, checked by `start()` after every await.
   *
   * `getUserMedia` sits behind a permission prompt, so it can be outstanding for as long as the user
   * takes to answer. Leave the call — or join a different one — while that prompt is open and
   * `stop()` ran against a null stream and found nothing to close; the promise then resolved into a
   * live camera and microphone that nothing held a reference to. **They stayed on for the life of
   * the document.**
   *
   * The transcribe store already solved exactly this with a generation counter; this is the same
   * idiom, which is worth saying because the next port needing it should reach for the same one.
   */
  let generation = 0;

  const state: MediaState = { audioEnabled: true, videoEnabled: true, screenShareEnabled: false };

  const emitState = () => options.onStateChanged?.({ ...state });

  const cameraTrack = () => stream?.getVideoTracks()[0] ?? null;
  const micTrack = () => stream?.getAudioTracks()[0] ?? null;
  const screenTrack = () => screenStream?.getVideoTracks()[0] ?? null;

  /** The video track the mesh should be sending right now: the screen while sharing, else the camera. */
  const publishVideo = () =>
    options.onTrackChanged?.('video', state.screenShareEnabled ? screenTrack() : cameraTrack());

  /**
   * The counterpart nobody needed until a microphone could change.
   *
   * The audio track used to be published exactly once, at `start`, and never again — which was
   * correct while the only thing that could happen to it was being muted, since muting keeps the
   * sender and flips `enabled`. A device switch replaces the track, so there has to be a way to say
   * so, and it has to exist beside `publishVideo` rather than as a line inside the switch: the two
   * kinds are otherwise asymmetric for no reason a reader could work out.
   */
  const publishAudio = () => options.onTrackChanged?.('audio', micTrack());

  /**
   * What was asked for last, so a later acquisition asks for the same thing.
   *
   * The camera re-acquire in `setVideoEnabled` used to rebuild its constraints from
   * `DEFAULT_CONSTRAINTS`, discarding whatever `start` had been given. Harmless while nothing ever
   * passed anything — and silently wrong the moment a chosen camera exists, because toggling video
   * off and on would quietly revert to the system default and the picker would go on claiming the
   * choice it no longer had.
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
      const mine = ++generation;
      /** Close a stream that arrived after this attempt was cancelled, rather than storing it. */
      const claim = (acquired: MediaStream): boolean => {
        if (mine === generation) return true;
        for (const track of acquired.getTracks()) track.stop();
        return false;
      };

      let acquired: MediaStream;
      try {
        // Through `constraintsFor`, not the argument as given, so a device chosen *before* joining
        // is asked for on the first acquisition rather than only on a later switch. That is the
        // ordinary path: the choice is made once in settings and every call after it uses it.
        acquired = await devices.getUserMedia({ audio: constraintsFor('audio'), video: constraintsFor('video') });
      } catch (error) {
        // A refused or missing camera must not stop the call — audio-only is a valid way to be in
        // one. Retry audio alone before giving up entirely.
        options.onError?.('acquiring camera and microphone', error);
        if (mine !== generation) return;
        try {
          acquired = await devices.getUserMedia({ audio: constraintsFor('audio') });
          if (!claim(acquired)) return;
          state.videoEnabled = false;
        } catch (audioError) {
          /*
            Nothing was acquired — and saying so is the whole of this branch.

            Denying the prompt denies the *request*, so the audio-only retry is refused too without
            prompting again. This used to return here, leaving `state` claiming `videoEnabled: true`
            and never calling `emitState()`. Both consequences were visible and neither was
            recoverable: the self tile had already been built with "wants a picture, has none" and so
            sat on **Connecting…** for the rest of the call, and `publishActivity` had already told
            every peer `videoEnabled: true`, so their tile for this agent sat on it too.

            The state is corrected to what is true — nothing is being sent — and emitted, which is
            what republishes presence and rebuilds the tiles.
          */
          options.onError?.('acquiring microphone', audioError);
          if (mine !== generation) return;
          state.videoEnabled = false;
          state.audioEnabled = false;
          emitState();
          return;
        }
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
      // Nothing is open yet — the choice is remembered and `start` will ask for it. This is the
      // ordinary path when somebody picks a device before joining.
      if (!stream) return true;

      const mine = generation;
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
      // what was acquired belongs to nobody — the generation check is `start`'s, for its reason.
      if (mine !== generation || !next) {
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
    },

    setAudioEnabled(enabled) {
      state.audioEnabled = enabled;
      for (const track of stream?.getAudioTracks() ?? []) track.enabled = enabled;
      emitState();
    },

    async setVideoEnabled(enabled) {
      // While sharing, the camera is not what is being sent — remember the preference and apply it
      // when the share stops, rather than silently doing nothing.
      videoBeforeShare = enabled;

      /*
        Turning the camera on when there is no camera means *getting* one.

        This used to set the flag and stop there. With no camera track to enable — the ordinary
        state after joining with video blocked — the flag was the only thing that changed: the self
        tile went to "wants a picture, has none" and stayed on **Connecting…**, and presence told
        every peer `videoEnabled: true`, so their tile for this agent stayed there too. Nothing could
        ever resolve it, because nothing was ever going to ask for a camera again.

        Asking again is also the right behaviour on its own terms. "We failed once" is not an answer
        to someone pressing the camera button: the usual reason they are pressing it is that they
        have just changed the permission.
      */
      if (enabled && !state.screenShareEnabled && !cameraTrack()) {
        const mine = generation;
        let acquired: MediaStream;
        try {
          // What was asked for at `start`, with whatever camera has been chosen since — not
          // `DEFAULT_CONSTRAINTS`, which is what this used to rebuild from and is how a chosen
          // camera quietly reverted to the system default on the first toggle off and on.
          acquired = await devices.getUserMedia({ video: constraintsFor('video') });
        } catch (error) {
          // Still refused. The flag goes back off rather than staying true with nothing behind it,
          // which is the state that could not be recovered from.
          options.onError?.('turning the camera on', error);
          if (mine !== generation) return;
          state.videoEnabled = false;
          emitState();
          return;
        }

        const track = acquired.getVideoTracks()[0] ?? null;
        if (mine !== generation || !track) {
          for (const orphan of acquired.getTracks()) orphan.stop();
          if (mine === generation) {
            state.videoEnabled = false;
            emitState();
          }
          return;
        }

        // Merged into the stream already being sent rather than replacing it, so the microphone
        // acquired earlier keeps running — and so `stop()` still closes everything from one place.
        if (stream) stream.addTrack(track);
        else stream = acquired;
        track.enabled = true;
        // The camera acquired here is as losable as the one acquired at `start` — see `watchForLoss`.
        watchForLoss(track, 'video');
        state.videoEnabled = true;
        publishVideo();
        emitState();
        return;
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
      generation += 1;
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
