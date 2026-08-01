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
  setVideoEnabled(enabled: boolean): void;
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
    // Restore whatever the camera was doing before, rather than assuming it should come back on.
    state.videoEnabled = videoBeforeShare;
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
      try {
        stream = await devices.getUserMedia(constraints);
      } catch (error) {
        // A refused or missing camera must not stop the call — audio-only is a valid way to be in
        // one. Retry audio alone before giving up entirely.
        options.onError?.('acquiring camera and microphone', error);
        try {
          stream = await devices.getUserMedia({ audio: constraints.audio ?? true });
          state.videoEnabled = false;
        } catch (audioError) {
          options.onError?.('acquiring microphone', audioError);
          return;
        }
      }

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

    setVideoEnabled(enabled) {
      state.videoEnabled = enabled;
      // While sharing, the camera is not what is being sent — remember the preference and apply it
      // when the share stops, rather than silently doing nothing.
      videoBeforeShare = enabled;
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
