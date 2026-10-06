/**
 * The media controller's state machine.
 *
 * Worth testing on its own because screen share is the one place where two pieces of state disagree
 * on purpose: while sharing, `videoEnabled` is false even though video is being sent. Getting that
 * wrong produces the bug where stopping a share leaves the camera off with the button saying it is on.
 */
import { describe, expect, it, vi } from 'vitest';

import { createMediaController, type MediaDeviceAccess, type MediaState } from './media';

function fakeTrack(kind: 'audio' | 'video') {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    kind,
    enabled: true,
    stopped: false,
    stop() {
      this.stopped = true;
    },
    addEventListener(event: string, cb: () => void) {
      (listeners[event] ??= []).push(cb);
    },
    /** Test helper: the browser's own "Stop sharing" bar ends the track this way. */
    end() {
      for (const cb of listeners.ended ?? []) cb();
    },
  };
}

/**
 * A `MediaStream` double with a *mutable* track list.
 *
 * Mutable because the real one is: turning the camera on mid-call merges the newly acquired track
 * into the stream already being sent, so the microphone from join keeps running. A fixed array
 * would have let that path pass a test it does not survive in a browser.
 */
function fakeStream(initial: ReturnType<typeof fakeTrack>[]) {
  const tracks = [...initial];
  return {
    getTracks: () => [...tracks],
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
    addTrack: (track: ReturnType<typeof fakeTrack>) => {
      if (!tracks.includes(track)) tracks.push(track);
    },
    removeTrack: (track: ReturnType<typeof fakeTrack>) => {
      const at = tracks.indexOf(track);
      if (at >= 0) tracks.splice(at, 1);
    },
  } as unknown as MediaStream;
}

function setup(overrides: Partial<MediaDeviceAccess> = {}) {
  const mic = fakeTrack('audio');
  const camera = fakeTrack('video');
  const screen = fakeTrack('video');

  const devices: MediaDeviceAccess = {
    getUserMedia: vi.fn(async () => fakeStream([mic, camera])),
    getDisplayMedia: vi.fn(async () => fakeStream([screen])),
    ...overrides,
  };

  const tracks: [string, unknown][] = [];
  const states: MediaState[] = [];
  const errors: string[] = [];

  const lost: string[] = [];

  const controller = createMediaController({
    devices,
    onTrackChanged: (kind, track) => tracks.push([kind, track]),
    onStateChanged: (state) => states.push(state),
    onDeviceLost: (kind) => lost.push(kind),
    onError: (context) => errors.push(context),
  });

  return { controller, devices, mic, camera, screen, tracks, states, errors, lost };
}

/** The track the mesh would currently be sending for a kind. */
const sent = (tracks: [string, unknown][], kind: string) =>
  [...tracks].reverse().find(([k]) => k === kind)?.[1] ?? null;

describe('media controller', () => {
  it('publishes mic and camera once started', async () => {
    const { controller, mic, camera, tracks } = setup();
    await controller.start();

    expect(sent(tracks, 'audio')).toBe(mic);
    expect(sent(tracks, 'video')).toBe(camera);
    expect(controller.state()).toEqual({ audioEnabled: true, videoEnabled: true, screenShareEnabled: false });
  });

  it('mutes by disabling the track, keeping the sender in place', async () => {
    const { controller, mic, tracks } = setup();
    await controller.start();
    const before = tracks.length;

    controller.setAudioEnabled(false);

    expect(mic.enabled).toBe(false);
    // No new outbound track: swapping one would force a renegotiation on every unmute.
    expect(tracks).toHaveLength(before);
    expect(controller.state().audioEnabled).toBe(false);
  });

  it('falls back to audio-only when the camera is refused', async () => {
    const mic = fakeTrack('audio');
    let call = 0;
    const { controller, errors, tracks } = setup({
      getUserMedia: vi.fn(async () => {
        if (call++ === 0) throw new Error('NotAllowedError');
        return fakeStream([mic]);
      }),
    });

    await controller.start();

    // A refused camera must not stop the call — audio-only is a valid way to be in one.
    expect(errors).toContain('acquiring camera and microphone');
    expect(sent(tracks, 'audio')).toBe(mic);
    expect(controller.state().videoEnabled).toBe(false);
  });

  it('reports nothing usable when even the microphone is refused', async () => {
    const { controller, errors } = setup({
      getUserMedia: vi.fn(async () => {
        throw new Error('NotAllowedError');
      }),
    });

    await controller.start();

    expect(errors).toEqual(['acquiring camera and microphone', 'acquiring microphone']);
    expect(controller.localStream()).toBeNull();
  });

  describe('screen share', () => {
    it('replaces the outbound video track and flags the state', async () => {
      const { controller, screen, tracks } = setup();
      await controller.start();

      await controller.startScreenShare();

      expect(sent(tracks, 'video')).toBe(screen);
      // videoEnabled false while screenShareEnabled true is the deliberate disagreement: the camera
      // is genuinely not what is being sent, and the roster is what tells peers to render `contain`.
      expect(controller.state()).toEqual({ audioEnabled: true, videoEnabled: false, screenShareEnabled: true });
    });

    it('restores the camera to what it was before the share', async () => {
      const { controller, camera, tracks } = setup();
      await controller.start();

      await controller.startScreenShare();
      controller.stopScreenShare();

      expect(sent(tracks, 'video')).toBe(camera);
      expect(camera.enabled).toBe(true);
      expect(controller.state().videoEnabled).toBe(true);
    });

    it('leaves the camera off if it was off before the share', async () => {
      const { controller, camera } = setup();
      await controller.start();
      controller.setVideoEnabled(false);

      await controller.startScreenShare();
      controller.stopScreenShare();

      // Turning the camera on because a share ended would put someone on screen who chose not to be.
      expect(camera.enabled).toBe(false);
      expect(controller.state().videoEnabled).toBe(false);
    });

    it("notices the browser's own Stop sharing button", async () => {
      const { controller, screen, camera, tracks } = setup();
      await controller.start();
      await controller.startScreenShare();

      // Ended out-of-band — the controller is never told directly.
      screen.end();

      expect(controller.state().screenShareEnabled).toBe(false);
      expect(sent(tracks, 'video')).toBe(camera);
    });

    it('remembers a camera toggle made while sharing', async () => {
      const { controller, camera, screen, tracks } = setup();
      await controller.start();
      await controller.startScreenShare();

      // The camera button still works while sharing; it just does not take effect yet.
      controller.setVideoEnabled(true);
      expect(sent(tracks, 'video')).toBe(screen);

      controller.stopScreenShare();
      expect(camera.enabled).toBe(true);
    });

    it('survives a cancelled picker without changing state', async () => {
      const { controller, errors, camera, tracks } = setup({
        getDisplayMedia: vi.fn(async () => {
          throw new Error('NotAllowedError');
        }),
      });
      await controller.start();

      await controller.startScreenShare();

      expect(errors).toContain('starting screen share');
      expect(controller.state().screenShareEnabled).toBe(false);
      expect(sent(tracks, 'video')).toBe(camera);
    });
  });

  it('releases every device on stop, so the camera light goes out', async () => {
    const { controller, mic, camera, screen, tracks } = setup();
    await controller.start();
    await controller.startScreenShare();

    controller.stop();

    expect(mic.stopped).toBe(true);
    expect(camera.stopped).toBe(true);
    expect(screen.stopped).toBe(true);
    expect(sent(tracks, 'audio')).toBeNull();
    expect(sent(tracks, 'video')).toBeNull();
  });
});

describe('starting a screen share', () => {
  /*
    Two very different outcomes used to arrive down one path and be treated alike, so a machine that
    *cannot* share a screen behaved exactly like a user who changed their mind: nothing happened and
    nothing was said. Found on Linux, where a desktop with no `org.freedesktop.portal.ScreenCast`
    interface makes WebKitGTK report `OverconstrainedError` — a strange name for "there is nothing
    here to capture", and unambiguously not the user declining.
  */
  const failing = (name: string) =>
    setup({
      getDisplayMedia: vi.fn(async () => {
        const error = new Error('no');
        error.name = name;
        throw error;
      }),
    });

  it('reports a machine that cannot capture a screen', async () => {
    const { controller } = failing('OverconstrainedError');
    expect(await controller.startScreenShare()).toBe('failed');
  });

  it('reports the user closing the picker as their decision, not a fault', async () => {
    const { controller } = failing('NotAllowedError');
    expect(await controller.startScreenShare()).toBe('cancelled');
  });

  it('reports a share that started', async () => {
    const { controller } = setup();
    expect(await controller.startScreenShare()).toBe('started');
  });

  it('leaves the state alone when it could not start', async () => {
    const { controller } = failing('OverconstrainedError');
    await controller.startScreenShare();
    expect(controller.state().screenShareEnabled).toBe(false);
  });
});

describe('when no device can be acquired at all', () => {
  /*
    Denying the prompt denies the *request*, so the audio-only retry is refused too without
    prompting again — this is the ordinary outcome of clicking Block, not an exotic one.

    It used to return without emitting, which left two things stuck and neither recoverable: the
    self tile had already been built as "wants a picture, has none" and sat on **Connecting…** for
    the rest of the call, and presence had already published `videoEnabled: true`, so every peer's
    tile for this agent sat on it too. Both were reported from real testing.
  */
  const denied = () =>
    setup({
      getUserMedia: vi.fn(async () => {
        throw new Error('NotAllowedError');
      }),
    });

  it('says that nothing is being sent, rather than saying nothing', async () => {
    const { controller, states } = denied();
    await controller.start();

    expect(controller.localStream()).toBeNull();
    expect(states.at(-1)).toEqual({ audioEnabled: false, videoEnabled: false, screenShareEnabled: false });
  });

  it('reports both failures, so the reason is in the log', async () => {
    const { controller, errors } = denied();
    await controller.start();

    expect(errors).toEqual(['acquiring camera and microphone', 'acquiring microphone']);
  });

  it('publishes no track, since there is none', async () => {
    const { controller, tracks } = denied();
    await controller.start();

    expect(tracks).toEqual([]);
  });

  it('does not overwrite the state of whatever cancelled it', async () => {
    // `stop()` emits once itself; what must not follow is the failure state, which would report a
    // muted microphone for a controller that has already been torn down and may be starting again.
    const { controller, states } = denied();
    const starting = controller.start();
    controller.stop();
    await starting;

    expect(states).toHaveLength(1);
    expect(states[0].audioEnabled).toBe(true);
  });
});

describe('turning the camera on when there is no camera', () => {
  /*
    Join with video blocked and audio allowed and there is no camera track — correctly, the fallback
    acquired audio alone. Pressing the camera button then used to set `videoEnabled: true` and stop
    there, which is the worst of both: the self tile went to "wants a picture, has none" and stayed
    on **Connecting…**, presence told every peer the same, and nothing was ever going to ask for a
    camera again. Reported from real testing, on both sides of the call.
  */
  const videoBlocked = () => {
    const mic = fakeTrack('audio');
    const camera = fakeTrack('video');
    let allowVideo = false;
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      if (constraints.video && !allowVideo) throw new Error('NotAllowedError');
      return fakeStream(constraints.video ? [camera] : [mic]);
    });
    return { ...setup({ getUserMedia }), camera, grant: () => (allowVideo = true) };
  };

  it('asks for one, and reports having it when the permission has since been granted', async () => {
    const { controller, camera, grant, tracks } = videoBlocked();
    await controller.start();
    expect(controller.state().videoEnabled).toBe(false);

    grant();
    await controller.setVideoEnabled(true);

    expect(controller.state().videoEnabled).toBe(true);
    expect(sent(tracks, 'video')).toBe(camera);
    // Merged into the stream already being sent, so the microphone acquired at join keeps running.
    expect(controller.localStream()?.getAudioTracks()).toHaveLength(1);
    expect(controller.localStream()?.getVideoTracks()).toHaveLength(1);
  });

  it('leaves the flag off when it is refused again, rather than true with nothing behind it', async () => {
    const { controller, errors, states } = videoBlocked();
    await controller.start();
    await controller.setVideoEnabled(true);

    // The whole point: `videoEnabled` must never be true with no track, because that is the state
    // the tiles — this agent's and every peer's — cannot recover from.
    expect(controller.state().videoEnabled).toBe(false);
    expect(states.at(-1)?.videoEnabled).toBe(false);
    expect(errors).toContain('turning the camera on');
  });

  it('does not go looking for a camera while a screen is being shared', async () => {
    const { controller, devices } = videoBlocked();
    await controller.start();
    await controller.startScreenShare();
    const before = (devices.getUserMedia as ReturnType<typeof vi.fn>).mock.calls.length;

    await controller.setVideoEnabled(true);

    expect((devices.getUserMedia as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(before);
  });

  it('does not restore a camera that never existed when the share stops', async () => {
    // `videoBeforeShare` remembers the preference; without also checking that a camera exists,
    // stopping the share put `videoEnabled: true` back with no track — the stuck state again.
    const { controller } = videoBlocked();
    await controller.start();
    await controller.setVideoEnabled(true);
    await controller.startScreenShare();
    controller.stopScreenShare();

    expect(controller.state().videoEnabled).toBe(false);
  });
});

describe('acquisition cancelled mid-prompt', () => {
  /**
   * `getUserMedia` sits behind a permission prompt, so it can be outstanding for as long as the user
   * takes to answer. Leaving the call in that window used to run `stop()` against a null stream —
   * nothing to close — and then the promise resolved into a live camera and microphone that nothing
   * held a reference to. They stayed on for the life of the document.
   */
  function deferredSetup() {
    const mic = fakeTrack('audio');
    const camera = fakeTrack('video');
    let release!: (stream: MediaStream) => void;
    const pending = new Promise<MediaStream>((resolve) => (release = resolve));

    const { controller, tracks, states, errors } = setup({ getUserMedia: vi.fn(() => pending) });
    return { controller, mic, camera, tracks, states, errors, arrive: () => release(fakeStream([mic, camera])) };
  }

  it('stops a stream that arrives after stop()', async () => {
    const { controller, mic, camera, arrive } = deferredSetup();

    const starting = controller.start();
    controller.stop();
    arrive();
    await starting;

    expect(mic.stopped).toBe(true);
    expect(camera.stopped).toBe(true);
    expect(controller.localStream()).toBeNull();
  });

  it('does not publish tracks the call no longer wants', async () => {
    const { controller, tracks, arrive } = deferredSetup();

    const starting = controller.start();
    controller.stop();
    arrive();
    await starting;

    // `stop()` publishes nulls; a late arrival must not put a live track back on the mesh after it.
    expect(sent(tracks, 'audio')).toBeNull();
    expect(sent(tracks, 'video')).toBeNull();
  });

  it('keeps a stream that arrives while the attempt is still current', async () => {
    const { controller, mic, arrive } = deferredSetup();

    const starting = controller.start();
    arrive();
    await starting;

    expect(mic.stopped).toBe(false);
    expect(controller.localStream()).not.toBeNull();
  });

  it('discards a superseded attempt when start is called twice', async () => {
    const first = fakeTrack('audio');
    const second = fakeTrack('audio');
    const streams = [fakeStream([first]), fakeStream([second])];
    let call = 0;
    const releases: Array<(s: MediaStream) => void> = [];
    const { controller } = setup({
      getUserMedia: vi.fn(() => new Promise<MediaStream>((resolve) => releases.push(resolve))),
    });

    const a = controller.start();
    controller.stop();
    const b = controller.start();
    releases[0](streams[call++]);
    releases[1](streams[call]);
    await Promise.all([a, b]);

    // The abandoned attempt's device is closed; the current one's is kept.
    expect(first.stopped).toBe(true);
    expect(second.stopped).toBe(false);
  });
});

/**
 * A device that goes away while it is being used.
 *
 * Nothing watched the tracks this agent was *sending*. Only remote ones were watched, and the screen
 * track for the browser's own "Stop sharing" bar — so unplugging a USB headset mid-call ended the
 * track and changed nothing else: the flag stayed true, presence went on publishing `audioEnabled:
 * true`, and every peer's roster showed this agent unmuted while they sent silence. No error,
 * nothing on screen, and no way to find out except by being told.
 */
describe('a device that is unplugged mid-call', () => {
  it('reports the microphone going, and stops claiming to be sending it', async () => {
    const { controller, mic, tracks, lost } = setup();
    await controller.start();

    mic.end();

    expect(lost, 'nobody was told the microphone went').toEqual(['audio']);
    expect(sent(tracks, 'audio'), 'the mesh was still being handed a dead track').toBe(null);
    expect(controller.state().audioEnabled, 'presence would have gone on saying unmuted').toBe(false);
  });

  it('reports the camera going, on its own terms', async () => {
    const { controller, camera, tracks, lost } = setup();
    await controller.start();

    camera.end();

    expect(lost).toEqual(['video']);
    expect(sent(tracks, 'video')).toBe(null);
    expect(controller.state().videoEnabled).toBe(false);
  });

  it('leaves the other device alone', async () => {
    // The two are independent: losing a camera is not a reason to stop sending audio, and the bug
    // this fixes would be replaced by a worse one if it were.
    const { controller, mic, camera, tracks } = setup();
    await controller.start();

    camera.end();

    expect(sent(tracks, 'audio')).toBe(mic);
    expect(controller.state().audioEnabled).toBe(true);
  });

  it('says nothing when the call ends, which is not a device going away', async () => {
    /*
      `track.stop()` does not fire `ended` — the spec fires it for the source ending, not for the
      consumer letting go — so hanging up is silent here by construction. Asserted because the whole
      design rests on it: if it were not true, every leave would report two lost devices.
    */
    const { controller, lost } = setup();
    await controller.start();

    controller.stop();

    expect(lost).toEqual([]);
  });
});

/**
 * Sending a different microphone or camera, mid-call.
 *
 * The swap itself was always free — `replaceTrack` does not renegotiate, which is the path screen
 * share has used since it was written. What had to be built was everything around it: the constraint
 * that pins a device, a way to publish a *replaced* audio track (it was published exactly once, at
 * start, and never again), and a new stream identity so the modules downstream learn about it.
 */
describe('choosing a device', () => {
  it('asks for the chosen one exactly, so it cannot silently open something else', async () => {
    /*
      `exact` rather than `ideal`. A soft hint is advisory and a browser may ignore it, which would
      give a picker that appears to work and does not — the one outcome with no way back, since
      nothing on screen would say the choice had not been taken.
    */
    const { controller, devices } = setup();
    await controller.start();

    await controller.setDevice('audio', 'mic-2');

    const asked = (devices.getUserMedia as unknown as { mock: { calls: [MediaStreamConstraints][] } }).mock.calls;
    expect(asked.at(-1)?.[0].audio).toMatchObject({ deviceId: { exact: 'mic-2' } });
  });

  it('publishes the replacement, which the audio side had no way to do', async () => {
    // A second microphone, so the swap is observable: the shared fake hands back the same track
    // objects every time, which is right for every other test here and useless for this one.
    const second = fakeTrack('audio');
    let opened = 0;
    const { controller, tracks } = setup({
      getUserMedia: async () => (++opened === 1 ? fakeStream([fakeTrack('audio')]) : fakeStream([second])),
    });
    await controller.start();
    const before = sent(tracks, 'audio');

    await controller.setDevice('audio', 'mic-2');

    expect(sent(tracks, 'audio'), 'the mesh was never told the microphone changed').not.toBe(before);
    expect(sent(tracks, 'audio')).toBe(second);
  });

  it('hands out a new stream, because identity is how the change is announced', async () => {
    /*
      The stream is shared: the store publishes it through `media.publish` and the transcriber reads
      it with `media.input()`. That store's setter dedupes on identity — deliberately, so a mute does
      not re-announce the same capture — so mutating the tracks in place would change what is being
      sent and tell nobody. The transcriber would go on listening to a microphone that had been
      unplugged from the graph, transcribing silence, with nothing saying why.
    */
    const { controller } = setup();
    await controller.start();
    const before = controller.localStream();

    await controller.setDevice('audio', 'mic-2');

    expect(controller.localStream()).not.toBe(before);
  });

  it('keeps the old device running when the new one cannot be opened', async () => {
    /*
      Acquire, then let go. A device unplugged between listing and choosing, or held exclusively by
      another application, must leave the call exactly as it was rather than silent — which is only
      true if the old track is stopped *after* the new one is open, never before.
    */
    const working = fakeTrack('audio');
    let opened = 0;
    const { controller, tracks } = setup({
      getUserMedia: async () => {
        // The join succeeds; the switch after it is refused.
        if (++opened === 1) return fakeStream([working]);
        throw new Error('device in use');
      },
    });
    await controller.start();

    const switched = await controller.setDevice('audio', 'mic-2');

    expect(switched, 'a refusal was reported as a success').toBe(false);
    expect(sent(tracks, 'audio'), 'the working device was dropped on a failed switch').toBe(working);
    expect(working.stopped, 'the old track was stopped before the new one was open').toBe(false);
  });

  it('remembers a choice made before anything is open', async () => {
    // Choosing before joining is the case the settings screen exists for, so this must not require a
    // live call — the id is kept and `start` asks for it.
    const { controller, devices } = setup();

    expect(await controller.setDevice('video', 'cam-9')).toBe(true);
    await controller.start();

    const asked = (devices.getUserMedia as unknown as { mock: { calls: [MediaStreamConstraints][] } }).mock.calls;
    expect(asked[0][0].video).toMatchObject({ deviceId: { exact: 'cam-9' } });
  });

  it('keeps asking for the chosen camera when video is toggled off and on', async () => {
    /*
      The re-acquire in `setVideoEnabled` rebuilt its constraints from `DEFAULT_CONSTRAINTS`,
      discarding whatever `start` was given. Harmless while nothing passed anything, and silently
      wrong the moment a chosen camera exists: the first toggle reverted to the system default while
      the picker went on claiming the choice.
    */
    const { controller, devices, camera } = setup();
    await controller.setDevice('video', 'cam-9');
    await controller.start();

    camera.end();
    await controller.setVideoEnabled(true);

    const asked = (devices.getUserMedia as unknown as { mock: { calls: [MediaStreamConstraints][] } }).mock.calls;
    expect(asked.at(-1)?.[0].video).toMatchObject({ deviceId: { exact: 'cam-9' } });
  });
});
