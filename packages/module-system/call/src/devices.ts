/**
 * Which microphone and camera this agent uses, remembered on this machine.
 *
 * ## Why this is not a module setting
 *
 * The module settings system is the obvious home and it is the wrong one, for two reasons that are
 * each sufficient.
 *
 * A declared setting's `options` are a static `{ label, value }[]` written into the manifest at build
 * time. A device list is discovered at runtime and changes when somebody plugs something in, so the
 * host's generic settings screen could not render a control for it even if the value fitted.
 *
 * And the levels a setting may be decided at — deployment, space, agent — are all "travels with
 * you". A `deviceId` is scoped to one origin on one physical machine: carried to another laptop it
 * names nothing, and the honest result of applying it there is either silence or the wrong device.
 * The call module's own `iceServers` docblock draws the line in the same place — *"which relay
 * reaches you is a fact about your network, not about the room you are in"* — and a microphone is
 * one step further out again, a fact about the machine rather than the person.
 *
 * So: `localStorage`, which is per-machine by construction, with the id validated against what is
 * actually present every time it is used.
 *
 * ## A stored id is a hint, never a promise
 *
 * Ids do not survive everything. Clearing site data rotates them, and a device that is unplugged
 * stops existing. Every read here is therefore "what was chosen, if it is still there" — a caller
 * that finds nothing falls back to the system default rather than failing, because a person who
 * unplugged a headset a week ago should get a working call, not an error about a device they have
 * forgotten owning.
 */

/** Keyed per kind, namespaced like every other key this deployment writes. */
const KEY = { audio: 'we.call.device.audio', video: 'we.call.device.video' } as const;

export type DeviceKind = 'audio' | 'video';

/**
 * `localStorage` is not merely absent in some contexts — it **throws**.
 *
 * Private windows, blocked site data, a document with an opaque origin. The same guard the dev-tools
 * switch carries, and for the same reason: a preference that cannot be stored must degrade to "no
 * preference", never to a broken call.
 */
function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The device chosen for this kind on this machine, or `''` for whatever the system offers. */
export function readChosenDevice(kind: DeviceKind): string {
  try {
    return store()?.getItem(KEY[kind]) ?? '';
  } catch {
    return '';
  }
}

/** Remember a choice, or forget it — an empty id is "let the system decide", not a third state. */
export function writeChosenDevice(kind: DeviceKind, deviceId: string): void {
  try {
    if (deviceId) store()?.setItem(KEY[kind], deviceId);
    else store()?.removeItem(KEY[kind]);
  } catch {
    // A machine that cannot remember the choice can still make it for this call.
  }
}
