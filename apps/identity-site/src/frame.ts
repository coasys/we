import {
  type ConnectAnswer,
  type ConnectDenied,
  type ConnectReady,
  type ConnectRenew,
  type ConnectRenewed,
  type ConnectRequest,
  originOf,
} from '@coasys/connect';

import { type BrowserKey, currentKey, indexedDbVault, keysSupported, type KeyVault, makeKey } from './browserKey';
import { deviceLink, qrSvg, runLink } from './link';
import { type PickerDevice, pickerList } from './record';
import type { Registry } from './registry';
import { ad4mExecutor, type ExecutorFactory, loginStatement, renewStatement } from './session';
import type { StoreClient } from './store';
import { Screen, TOO_OLD } from './ui';

/** Why a call failed, as words: an `Error`, or the `{code, reason}` the WASM throws. */
const reasonOf = (failure: unknown): string =>
  failure instanceof Error ? failure.message : ((failure as { reason?: string } | null)?.reason ?? 'failed');

export interface FrameDeps {
  /** The frame's own window: where messages arrive. */
  self: Window;
  /** The embedding window or the opener: the only sender listened to. */
  host: Window;
  screen: Screen;
  registry: Registry;
  store: StoreClient;
  /** The link's hint: what the holder shows for this browser. */
  hint: string;
  vault?: KeyVault;
  executor?: ExecutorFactory;
  supported?: () => Promise<boolean>;
  now?: () => number;
}

interface Session {
  origin: string;
  executor?: string;
}

const isText = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function isRequest(m: Record<string, unknown>): m is ConnectRequest {
  const app = m.app as Record<string, unknown> | undefined;
  return (
    isText(m.state) &&
    isText(m.origin) &&
    isText(m.codeChallenge) &&
    !!app &&
    isText(app.appId) &&
    isText(app.name) &&
    Array.isArray(m.capabilities)
  );
}

/**
 * The Connect frame. It answers an app only at the origin the registry lists for the app and the
 * browser reported for the message; everything else is refused without an answer.
 */
export function startFrame(deps: FrameDeps): () => void {
  const { screen, store } = deps;
  const vault = deps.vault ?? indexedDbVault;
  const executorFor = deps.executor ?? ad4mExecutor;
  const now = deps.now ?? Date.now;
  const sessions = new Map<string, Session>();

  const post = (origin: string, message: ConnectAnswer | ConnectRenewed | ConnectDenied) =>
    deps.host.postMessage(message, origin);

  async function ensureLinked(): Promise<BrowserKey> {
    const saved = await currentKey(vault, now());
    if (saved?.scid) return saved;
    const key = saved ?? (await makeKey(now()));
    if (!saved) await vault.save(key);
    const abort = new AbortController();
    const link = await deviceLink(key, store.base, deps.hint, Math.floor(now() / 1000));
    screen.link({ link, qrSvg: qrSvg(link) }, () => abort.abort());
    return runLink({
      key,
      store,
      vault,
      hint: deps.hint,
      now,
      onMatch: (code) => screen.match(code),
      signal: abort.signal,
    });
  }

  function pick(devices: PickerDevice[]): Promise<PickerDevice> {
    return new Promise((resolve) => screen.picker(devices, resolve));
  }

  async function connect(request: ConnectRequest, origin: string): Promise<void> {
    const key = await ensureLinked();
    const devices = await pickerList(store, key, key.keyId as string, key.scid as string);
    if (!devices.length) return screen.message('No device to connect to', 'None of your devices runs an executor.');
    const device = await pick(devices);
    const executor = executorFor(device.address);
    try {
      const challenge = await executor.sessionChallenge();
      const proof = await loginStatement(
        key,
        device.address,
        challenge,
        origin,
        request.codeChallenge,
        Math.floor(now() / 1000),
      );
      const { code } = await executor.loginWithKeyForWeb(proof, request);
      sessions.set(request.state, { origin, executor: device.address });
      post(origin, {
        type: 'connected',
        state: request.state,
        executor: device.address,
        code,
        did: `did:scid:coasys:1:${key.scid}`,
      });
      screen.message('Connected', `${request.app.name} is connected.`);
    } finally {
      executor.close();
    }
  }

  async function onConnect(event: MessageEvent, request: ConnectRequest): Promise<void> {
    const app = await deps.registry(request.app.appId);
    // The browser's `event.origin` is the only origin that counts: the request's own field must agree with it.
    if (!app || !app.origins.includes(event.origin) || originOf(request.origin) !== event.origin) {
      return screen.refused();
    }
    screen.askedBy(app.name, event.origin);
    if (!(await (deps.supported ?? keysSupported)())) return screen.message(TOO_OLD);
    try {
      await connect(request, event.origin);
    } catch (failure) {
      post(event.origin, { type: 'denied', state: request.state, reason: reasonOf(failure) });
      screen.message('Could not connect', reasonOf(failure));
    }
  }

  async function onRenew(event: MessageEvent, m: ConnectRenew): Promise<void> {
    const session = sessions.get(m.state);
    if (!session || session.origin !== event.origin) return;
    const key = await currentKey(vault, now());
    if (!key?.scid) return post(session.origin, { type: 'denied', state: m.state, reason: 'no-key' });
    const proof = await renewStatement(
      key,
      m.executor,
      m.challenge,
      session.origin,
      m.grantId,
      Math.floor(now() / 1000),
    );
    post(session.origin, { type: 'renewed', state: m.state, proof });
  }

  function onMessage(event: MessageEvent): void {
    if (event.source !== deps.host || typeof event.data !== 'object' || event.data === null) return;
    const m = event.data as Record<string, unknown>;
    if (m.type === 'connect' && isRequest(m)) void onConnect(event, m);
    else if (m.type === 'renew' && isText(m.state) && isText(m.executor) && isText(m.grantId) && m.challenge)
      void onRenew(event, m as unknown as ConnectRenew);
    else if (m.type === 'sign-out' && isText(m.state)) {
      const session = sessions.get(m.state);
      if (session?.origin === event.origin) sessions.delete(m.state);
    }
  }

  deps.self.addEventListener('message', onMessage);
  // The embedder's origin is not known before its request arrives; `ready` carries nothing secret.
  deps.host.postMessage({ type: 'ready' } satisfies ConnectReady, '*');
  return () => deps.self.removeEventListener('message', onMessage);
}
