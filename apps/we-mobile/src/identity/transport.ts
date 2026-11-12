/**
 * The phone's identity page as an `IdentityTransport`: the shared identity window's screens, made
 * from the `DeviceKey` plugin's calls. On a computer a custody service sends the screens; on the
 * phone the plugin's Kotlin and Rust do every signing and network call, and the master key stays
 * behind the biometric prompt the plugin raises. Nothing secret crosses here: the phone takes no
 * passphrase and no words, so no screen it makes asks for either.
 *
 * What the phone can run: joining an identity by an offer (scanned or pasted), adding a device by
 * the code it shows, taking, asking for and sending the master key, answering a revoke request, and
 * naming and revoking a device. Replacing the master key, restoring, and anything else that needs
 * the 12 words runs on a computer.
 */
import type { IdentityTransport, RevokeTarget, Screen, StepInput } from '@we/identity-window';

import type { DeviceKeyPlugin, DeviceRequestView, PhoneDeviceView } from '../../../we-web/src/platform/deviceKey';

/** What the page was opened on: joining an identity, or one of WE's identity changes. */
export type PhoneStart =
  | { kind: 'join' }
  | { kind: 'scan-device' }
  | { kind: 'take-master' }
  | { kind: 'ask-master' }
  | { kind: 'answer-request'; id: string }
  | { kind: 'rename'; keyId: string }
  | { kind: 'revoke'; keyId: string }
  | { kind: string };

/** How the page ended, which it hands back to WE. */
export type PhoneOutcome = 'done' | 'cancelled' | 'failed';

export interface PhoneTransportDeps {
  plugin: DeviceKeyPlugin;
  /** Leaves the page; WE starts again. */
  leave(outcome: PhoneOutcome): void;
  /** The name the phone suggests for itself when it joins. */
  hint?: string;
  /**
   * The executor the phone logs in to with its device key (WE's `we-phone/key-host`). Given, the
   * join screen asks for it beside the offer, and it is kept once the offer is claimed.
   */
  keyHost?: { read(): string | null; remember(url: string): void };
}

/** The executor's address, when it is an http(s) URL. */
export function executorUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
}

/**
 * What the page's address opens it on: `?change=` WE's change as JSON, or `?join`. Anything else
 * is no change the page knows.
 */
export function pageStart(search: string): PhoneStart | null {
  const params = new URLSearchParams(search);
  if (params.has('join')) return { kind: 'join' };
  const raw = params.get('change');
  if (!raw) return null;
  try {
    const change: unknown = JSON.parse(raw);
    if (!change || typeof change !== 'object' || typeof (change as { kind?: unknown }).kind !== 'string') return null;
    const { kind, id, keyId } = change as { kind: string; id?: unknown; keyId?: unknown };
    if (kind === 'answer-request') return typeof id === 'string' ? { kind, id } : null;
    if (kind === 'rename' || kind === 'revoke') return typeof keyId === 'string' ? { kind, keyId } : null;
    return { kind };
  } catch {
    return null;
  }
}

/**
 * Where the page goes back to: a path of this app's own, else its start. The check runs on the
 * URL the browser would make of `back`, not on the raw text — parsing removes control
 * characters (a tab or newline between the first two slashes would turn `/\tevil` into
 * `//evil`, a network-path reference to another origin) and folds `\` into `/` — so the
 * decoded text passing a `startsWith('/')` check is not enough.
 */
export function backPath(search: string, origin: string): string {
  const back = new URLSearchParams(search).get('back');
  if (!back || /[\u0000-\u001f\u007f]/.test(back)) return '/';
  try {
    const url = new URL(back, origin);
    if (url.origin !== origin) return '/';
    const path = url.pathname + url.search + url.hash;
    // Only ever a same-origin local path: a path that is (or that a special-scheme URL would
    // re-parse as) a network-path reference leaves the app's origin on `location.replace`.
    if (path.startsWith('//') || path.includes('\\')) return '/';
    return path;
  } catch {
    return '/';
  }
}

/** Why the phone does not run a change: one only a computer can. */
export const ON_A_COMPUTER =
  'This phone cannot do that: it needs your 12 words, which only a computer takes. Do it on a computer that has your identity.';

const NO_MASTER_WAITING =
  'No master key waits for this phone yet. Send it from the device that keeps it, then choose “Take the master key” here again.';

const ROTATE_ON_A_COMPUTER =
  'Replacing the master key needs your 12 words, which this phone does not take. Revoke the device here without it, then replace your master key on a computer.';

/** A plugin refusal's own words. */
export function reason(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return typeof error === 'string' ? error : 'The phone refused without saying why.';
}

const code = (error: unknown): string | undefined =>
  error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;

/** How long one `waitJoined` asks the store, and how long a join waits in all. */
const JOIN_WAIT_SECONDS = 30;

/** The keys a revoke request names, as the window lists them: by id and key, beside the name. */
export function revokeTargets(request: DeviceRequestView, devices: PhoneDeviceView[]): RevokeTarget[] {
  return request.targetKeys.map((keyId, i) => {
    const device = devices.find((d) => d.keyId === keyId);
    return {
      keyId,
      fingerprint: device?.fingerprint ?? 'not in the key log',
      recordName: request.targets[i] ?? device?.name ?? null,
      mayHoldMaster: device?.mayKeepMaster ?? false,
    };
  });
}

export function phoneTransport(start: PhoneStart, deps: PhoneTransportDeps): IdentityTransport {
  const { plugin } = deps;
  /** The holder link `scan-device` runs, while it runs. */
  let link: string | null = null;
  let cancelled = false;
  let last: Screen | null = null;
  /** The request `answer-request` shows, and the device `revoke` and `rename` act on. */
  let request: (Screen & { screen: 'request' }) | null = null;
  let device: PhoneDeviceView | null = null;

  const failed = (message: string): Screen => ({ screen: 'failed', message });
  const shown = (screen: Screen): Screen => (last = screen);

  async function findDevice(keyId: string): Promise<PhoneDeviceView | null> {
    const { devices } = await plugin.devices();
    return devices.find((d) => d.keyId === keyId && d.revokedSeq === null) ?? null;
  }

  async function take(): Promise<Screen> {
    const { taken } = await plugin.takeMaster();
    return taken ? { screen: 'master-taken', did: taken.did, note: taken.note } : failed(NO_MASTER_WAITING);
  }

  /** The code card. A phone joins with its own key, never as a desktop's first run: nothing to accept here. */
  function matching(code: string, did: string): Screen {
    return { screen: 'device-match', code, did, needsAccept: false, accepted: false, confirmed: false };
  }

  async function joinStart(): Promise<Screen> {
    const status = await plugin.status();
    if (status.identity) return failed(`This phone is one of your devices already, as ${status.identity.did}.`);
    if (!status.keys) await plugin.create();
    if (status.pending) return matching(status.pending.matchCode, status.pending.did);
    return offerScreen(null, deps.keyHost?.read() ?? '');
  }

  function offerScreen(error: string | null, host: string): Screen {
    return deps.keyHost ? { screen: 'enter-offer', error, host } : { screen: 'enter-offer', error };
  }

  async function waitJoined(): Promise<Screen> {
    for (;;) {
      if (cancelled) return failed('Cancelled.');
      const { progress } = await plugin.waitJoined({ seconds: JOIN_WAIT_SECONDS });
      if (progress.state === 'joined') {
        const keyId = await plugin.identityStatus().then(
          (view) => view.keyId,
          () => null,
        );
        return { screen: 'joined', did: progress.did, keyId: keyId ?? 'a new device key' };
      }
      if (progress.state === 'ended') return failed(progress.reason);
    }
  }

  async function nextLinkStep(): Promise<Screen> {
    if (!link) return failed('That link is over.');
    const step = await plugin.linkNext({ link });
    switch (step.step) {
      case 'ticket-sent':
        return { screen: 'code-sent', expires: step.expires };
      case 'claimed':
        return { screen: 'match', code: step.code, hint: step.hint, canKeep: step.canKeepMaster, ownName: false };
      case 'linked':
        link = null;
        return { screen: 'linked', seq: step.seq, masterSent: step.masterSent, note: step.note };
    }
  }

  async function begin(): Promise<Screen> {
    switch (start.kind) {
      case 'join':
        return joinStart();
      case 'scan-device':
        return { screen: 'enter-code', error: null };
      case 'take-master':
        return take();
      case 'ask-master': {
        const asked = await plugin.askForMaster();
        return { screen: 'asked', keyId: asked.keyId, fingerprint: asked.fingerprint, code: asked.code };
      }
      case 'answer-request': {
        const id = (start as { id: string }).id;
        const [{ requests }, { devices }] = await Promise.all([plugin.requests(), plugin.devices()]);
        const found = requests.find((r) => r.id === id);
        if (!found) return failed('That request was answered already, or it expired.');
        if (found.problem) return failed(found.problem);
        request = {
          screen: 'request',
          id: found.id,
          kind: found.kind,
          device: found.device,
          keyId: found.by,
          fingerprint: found.fingerprint,
          code: found.code,
          targets: revokeTargets(found, devices),
          passphrase: false,
          error: null,
        };
        return request;
      }
      case 'rename': {
        device = await findDevice((start as { keyId: string }).keyId);
        return device
          ? { screen: 'rename', keyId: device.keyId, name: device.name, error: null }
          : failed('That device is not one of yours, or it was revoked.');
      }
      case 'revoke': {
        device = await findDevice((start as { keyId: string }).keyId);
        if (!device) return failed('That device is not one of yours, or it was revoked already.');
        if (device.thisDevice) return failed('Revoke this phone from another of your devices.');
        return {
          screen: 'revoke-confirm',
          keyId: device.keyId,
          mayHoldMaster: device.mayKeepMaster,
          rotate: false,
          passphrase: false,
          error: null,
        };
      }
      default:
        return failed(ON_A_COMPUTER);
    }
  }

  async function advance(input: StepInput): Promise<Screen> {
    switch (input.kind) {
      case 'offer': {
        const typedHost = input.host ?? '';
        const host = deps.keyHost ? executorUrl(typedHost) : null;
        if (deps.keyHost && !host) {
          return offerScreen('Type the address of the executor this phone signs in to, starting https://.', typedHost);
        }
        try {
          const joined = await plugin.join({ link: input.link, ...(deps.hint ? { hint: deps.hint } : {}) });
          if (host) deps.keyHost?.remember(host);
          return matching(joined.matchCode, joined.did);
        } catch (error) {
          return offerScreen(reason(error), typedHost);
        }
      }
      case 'wait-join':
        return waitJoined();
      case 'code':
        try {
          link = (await plugin.scanDevice({ code: input.code })).link;
        } catch (error) {
          return { screen: 'enter-code', error: reason(error) };
        }
        return nextLinkStep();
      case 'wait-claim':
        return nextLinkStep();
      case 'confirm':
        if (!link) return failed('That link is over.');
        await plugin.linkConfirm({
          link,
          ...(input.name ? { name: input.name } : {}),
          keepMaster: input.keepMaster ?? false,
        });
        return nextLinkStep();
      case 'answer':
        if (!request) return failed('That request is over.');
        try {
          const answered = await plugin.answer({ id: request.id });
          return { screen: 'request-answered', kind: request.kind, device: answered.device, note: answered.note };
        } catch (error) {
          const message = code(error) === 'NeedsWords' ? ON_A_COMPUTER : reason(error);
          return { ...request, error: message };
        }
      case 'name': {
        if (!device) return failed('That device is not one of yours.');
        try {
          await plugin.rename({ keyId: device.keyId, name: input.name });
        } catch (error) {
          return { screen: 'rename', keyId: device.keyId, name: input.name, error: reason(error) };
        }
        return { screen: 'renamed', keyId: device.keyId, name: input.name.trim() };
      }
      case 'revoke': {
        if (!device) return failed('That device is not one of yours.');
        const confirm: Screen = {
          screen: 'revoke-confirm',
          keyId: device.keyId,
          mayHoldMaster: device.mayKeepMaster,
          rotate: false,
          passphrase: false,
          error: null,
        };
        if (input.rotate) return { ...confirm, error: ROTATE_ON_A_COMPUTER };
        try {
          await plugin.revoke({ keyIds: [device.keyId] });
        } catch (error) {
          return { ...confirm, error: code(error) === 'NeedsWords' ? ROTATE_ON_A_COMPUTER : reason(error) };
        }
        // The entry that revoked it, as the log now lists it.
        const keyId = device.keyId;
        const { devices } = await plugin.devices();
        const seq = devices.find((d) => d.keyId === keyId)?.revokedSeq ?? null;
        if (seq === null) return failed(`The store does not list ${keyId} as revoked yet. Look again in a moment.`);
        return { screen: 'revoked', keyId, seq };
      }
      default:
        return failed(ON_A_COMPUTER);
    }
  }

  const guarded = async (call: () => Promise<Screen>): Promise<Screen> => {
    try {
      return shown(await call());
    } catch (error) {
      return shown(failed(reason(error)));
    }
  };

  return {
    deviceNoun: 'phone',
    start: () => guarded(begin),
    step: (input) => guarded(() => advance(input)),
    async cancel() {
      cancelled = true;
      const open = link;
      link = null;
      if (open) await plugin.linkCancel({ link: open }).catch(() => undefined);
      deps.leave('cancelled');
    },
    finish() {
      deps.leave(last?.screen === 'failed' ? 'failed' : 'done');
      return Promise.resolve();
    },
    async scan(prefix) {
      try {
        return (await plugin.scanCode({ prefix })).text;
      } catch (error) {
        if (code(error) === 'Cancelled') return null;
        throw new Error(reason(error));
      }
    },
  };
}
