/**
 * A registration this device already saw through costs the caller nothing.
 *
 * `registerModels` fingerprints the declared shapes it would send, and remembers — in memory for
 * the session, in `localStorage` for the device — that a `registerShapes` carrying them resolved
 * in this perspective. A repeat call in the session sends nothing, not even the marker read; a
 * repeat on the device answers at once and re-registers in the background, so a peer's change
 * still reaches the executor without the boot or a space switch waiting on it.
 *
 * Node has no `localStorage`, so the device memo is exercised through a stubbed map. A "new
 * session" is the module re-imported under `vi.resetModules`, which drops the in-memory memo and
 * keeps the stubbed device one.
 */
import { SHACLShape } from '@coasys/ad4m';
import {
  classNameOf,
  compileManifest,
  installModuleSdna,
  installSpaceSdna,
  refreshSpaceSdna,
  SPACE_MODELS,
} from '@we/backend-ad4m';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeShapeRegistry } from './fakeShapeRegistry';

/** A microtask round plus the executor the fake answers synchronously. */
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** The class names WE's space models register under — as `registerModels.test.ts` computes them. */
const spaceNames = () =>
  SPACE_MODELS.filter((model) => !Object.prototype.hasOwnProperty.call(model, 'builtinUri')).map((model) => {
    const { shape } = model.generateSHACL() as { shape: SHACLShape };
    return classNameOf(shape.targetClass!);
  });

/** The device memo's store, as a map `localStorage` answers. */
function stubLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  });
  return data;
}

/** A fresh session: the module re-imported, its in-memory memo gone, the device's kept. */
async function newSession() {
  vi.resetModules();
  return import('@we/backend-ad4m');
}

/** `registerShapes` that answers only once `release` is called — a wait that can be observed. */
function heldAnswers(r: ReturnType<typeof fakeShapeRegistry>) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const answer = r.perspective.registerShapes.bind(r.perspective);
  r.perspective.registerShapes = async (shapes) => {
    await held;
    return answer(shapes);
  };
  return () => release();
}

/** One class, one manifest version at a time — the "a build changed a shape" stand-in. */
const widget = (note: boolean) =>
  Object.values(
    compileManifest(
      {
        version: '1',
        entities: {
          Widget: {
            properties: { label: { type: 'string' }, ...(note ? { note: { type: 'string' } } : {}) },
            relations: {},
          },
        },
      },
      { moduleId: 'mod' },
    ),
  );

afterEach(() => vi.unstubAllGlobals());

describe('the registration memo', () => {
  it('waits for the executor the first time a set registers', async () => {
    const r = fakeShapeRegistry();
    const release = heldAnswers(r);

    let answered = false;
    const call = refreshSpaceSdna(r.proxy).then((written) => ((answered = true), written));
    await tick();
    expect(answered).toBe(false); // a first registration is awaited, as before

    release();
    const written = await call;
    expect(answered).toBe(true);
    expect([...written].sort()).toEqual([...spaceNames()].sort());
  });

  it('sends nothing — not even the marker read — on a repeat call in the session', async () => {
    const r = fakeShapeRegistry();
    await installSpaceSdna(r.proxy);

    expect(await refreshSpaceSdna(r.proxy)).toEqual([]);
    expect(r.calls.registerShapes).toHaveLength(1);
    expect(r.calls.gets).toHaveLength(1); // the install's marker read was the only one
  });

  it('answers at once on a device memo, and re-registers once in the background', async () => {
    stubLocalStorage();
    const r = fakeShapeRegistry();
    await installSpaceSdna(r.proxy);

    const session = await newSession();
    const release = heldAnswers(r);
    const written = await session.refreshSpaceSdna(r.proxy);
    // The caller got its answer while the executor's was still out.
    expect(written).toEqual([]);

    release();
    await vi.waitFor(() => expect(r.calls.registerShapes).toHaveLength(2));
    // The re-check wrote nothing: the memo told the truth.
    expect(r.calls.written.at(-1)).toEqual([]);

    // And a second ask in the new session starts no second background registration.
    expect(await session.refreshSpaceSdna(r.proxy)).toEqual([]);
    expect(r.calls.registerShapes).toHaveLength(2);
  });

  it('waits again for a model set it has not confirmed — a changed shape is a new fingerprint', async () => {
    const r = fakeShapeRegistry();
    await installModuleSdna(r.proxy, widget(false));

    const release = heldAnswers(r);
    let answered = false;
    const call = installModuleSdna(r.proxy, widget(true)).then(() => (answered = true));
    await tick();
    expect(answered).toBe(false);

    release();
    await call;
    expect(r.calls.written.at(-1)).toHaveLength(1); // Widget's new shape was written
  });

  it('does not remember a rejected registration — the next call waits again', async () => {
    stubLocalStorage();
    const r = fakeShapeRegistry();
    await installSpaceSdna(r.proxy);

    const session = await newSession();
    // The background re-check fails: the memo it was confirming is dropped.
    let down = true;
    const answer = r.perspective.registerShapes.bind(r.perspective);
    r.perspective.registerShapes = async (shapes) => {
      if (down) {
        down = false;
        throw Object.assign(new Error('executor down'), { status: 503 });
      }
      return answer(shapes);
    };
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(await session.refreshSpaceSdna(r.proxy)).toEqual([]);
      await vi.waitFor(() => expect(errors).toHaveBeenCalled());

      const release = heldAnswers(r);
      let answered = false;
      const retry = session.refreshSpaceSdna(r.proxy).then(() => (answered = true));
      await tick();
      expect(answered).toBe(false); // no memo left to trust: the caller waits again
      release();
      await retry;
      // Two recorded calls: the install's and the retry's — the one the executor refused was never
      // answered, so it was never recorded.
      expect(r.calls.registerShapes).toHaveLength(2);
    } finally {
      errors.mockRestore();
    }
  });

  it('keeps one device entry per model set — a changed set replaces its old print', async () => {
    const device = stubLocalStorage();
    const r = fakeShapeRegistry();
    await installModuleSdna(r.proxy, widget(false));
    const before = JSON.parse(device.get(`we.sdna:${r.perspective.uuid}`)!);

    await installModuleSdna(r.proxy, widget(true));
    const after = JSON.parse(device.get(`we.sdna:${r.perspective.uuid}`)!);

    expect(Object.keys(after)).toEqual(Object.keys(before));
    expect(Object.values(after)).not.toEqual(Object.values(before));
  });

  it('shares one registration between callers asking at the same time', async () => {
    const r = fakeShapeRegistry();

    await Promise.all([installSpaceSdna(r.proxy), refreshSpaceSdna(r.proxy)]);

    expect(r.calls.registerShapes).toHaveLength(1);
  });
});
