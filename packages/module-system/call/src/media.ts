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
  setAudioEnabled(enabled: boolean): void;
  setVideoEnabled(enabled: boolean): Promise<void>;
  startScreenShare(): Promise<void>;
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
  const screenTrack = () => screenStream?.getVideoTracks()[0] ?? null;

  /** The video track the mesh should be sending right now: the screen while sharing, else the camera. */
  const publishVideo = () =>
    options.onTrackChanged?.('video', state.screenShareEnabled ? screenTrack() : cameraTrack());

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
      const mine = ++generation;
      /** Close a stream that arrived after this attempt was cancelled, rather than storing it. */
      const claim = (acquired: MediaStream): boolean => {
        if (mine === generation) return true;
        for (const track of acquired.getTracks()) track.stop();
        return false;
      };

      let acquired: MediaStream;
      try {
        acquired = await devices.getUserMedia(constraints);
      } catch (error) {
        // A refused or missing camera must not stop the call — audio-only is a valid way to be in
        // one. Retry audio alone before giving up entirely.
        options.onError?.('acquiring camera and microphone', error);
        if (mine !== generation) return;
        try {
          acquired = await devices.getUserMedia({ audio: constraints.audio ?? true });
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

      for (const track of stream.getAudioTracks()) track.enabled = state.audioEnabled;
      for (const track of stream.getVideoTracks()) track.enabled = state.videoEnabled;

      options.onTrackChanged?.('audio', stream.getAudioTracks()[0] ?? null);
      publishVideo();
      emitState();
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
          acquired = await devices.getUserMedia({ video: DEFAULT_CONSTRAINTS.video ?? true });
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
      if (state.screenShareEnabled) return;
      try {
        screenStream = await devices.getDisplayMedia({ video: true });
      } catch (error) {
        // Cancelling the picker lands here and is not an error worth surfacing loudly.
        options.onError?.('starting screen share', error);
        return;
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
