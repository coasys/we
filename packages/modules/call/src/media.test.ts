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

function fakeStream(tracks: ReturnType<typeof fakeTrack>[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
    getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
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

  const controller = createMediaController({
    devices,
    onTrackChanged: (kind, track) => tracks.push([kind, track]),
    onStateChanged: (state) => states.push(state),
    onError: (context) => errors.push(context),
  });

  return { controller, devices, mic, camera, screen, tracks, states, errors };
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
