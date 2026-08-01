/**
 * `MediaStream` for a Node test run.
 *
 * The mesh groups its outbound tracks into one stream and collects each peer's inbound tracks into
 * another, so it constructs `MediaStream` even when no media exists. That is a browser global with no
 * Node equivalent and none in jsdom either.
 *
 * Stubbed here rather than injected as a factory: the mesh's use of it is real behaviour worth
 * keeping honest in the signature, and a `createMediaStream` option would exist purely for tests.
 */
class FakeMediaStream {
  #tracks: unknown[];
  constructor(tracks: unknown[] = []) {
    this.#tracks = [...tracks];
  }
  getTracks() {
    return [...this.#tracks];
  }
  addTrack(track: unknown) {
    if (!this.#tracks.includes(track)) this.#tracks.push(track);
  }
  removeTrack(track: unknown) {
    const i = this.#tracks.indexOf(track);
    if (i !== -1) this.#tracks.splice(i, 1);
  }
}

if (!(globalThis as { MediaStream?: unknown }).MediaStream) {
  (globalThis as { MediaStream?: unknown }).MediaStream = FakeMediaStream;
}
