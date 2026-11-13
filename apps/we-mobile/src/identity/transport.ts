/**
 * The phone's identity page as an `IdentityTransport`: the shared identity window's screens, made
 * from the `DeviceKey` plugin's calls. On a computer a custody service sends the screens; on the
 * phone the plugin's Kotlin and Rust do every signing and network call, and the master key stays
 * behind the biometric prompt the plugin raises. The phone takes no passphrase.
 *
 * What the phone can run: joining an identity by an offer (scanned or pasted), adding a device by
 * the code it shows, taking, asking for and sending the master key, answering a revoke request,
 * naming and revoking a device, and the three flows of the 12 words — making an identity
 * (`create`), restoring one (`restore`) and replacing the master key (`replace-master`) — which
 * the plugin runs as step machines (`startMake`, `startRestore`, `startRotate`, `identityStep`).
 *
 * **The words.** They cross this page twice: shown once by `show-words`, and typed into
 * `confirm-words` and `enter-words`. The window is secure (`setSecure`: no screenshots, no
 * recent-apps thumbnail) from before the flow starts until the page leaves. The mark is not cleared
 * when the next screen comes: this side answers a screen before the window draws it, so the words
 * would still be in the page. It is cleared in `cancel` and `finish`, which the window calls
 * after it has blanked its screen (`blankedBefore` in `@we/identity-window`), and in `gone`, which
 * the page calls on `pagehide` after it has emptied itself. The page keeps no
 * copy: the screens pass to the window and are not held here, the inputs go to the plugin in the step that reads them, and nothing is
 * logged, put on the clipboard, in the address or in storage. The window clears its word fields
 * when another screen comes.
 */
import type { IdentityTransport, RevokeTarget, Screen, StepInput } from '@we/identity-window';

import type {
  DeviceKeyPlugin,
  DeviceRequestView,
  IdentityFlowStart,
  IdentityInput,
  IdentityScreen,
  PhoneDeviceView,
} from '../../../we-web/src/platform/deviceKey';

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
export const ON_A_COMPUTER = 'This phone cannot do that. Do it on a computer that has your identity.';

const NO_MASTER_WAITING =
  'No master key waits for this phone yet. Send it from the device that keeps it, then choose “Take the master key” here again.';

/** A revoke that also replaces the master key: the phone does the two one after the other. */
export const ROTATE_AFTER =
  'This phone does not replace your master key in the same step as a revoke. Revoke the device here without it, then choose “Replace my master key” in Settings.';

/** A revoke request that also replaces the master key, which the phone does not answer in one step. */
export const ANSWER_ON_A_COMPUTER =
  'That request also replaces your master key in the same step, which this phone does not do. Answer it on a computer that has your identity.';

/** The changes the plugin runs as a flow of the 12 words, and the call that starts each. */
const FLOWS = { create: 'startMake', restore: 'startRestore', 'replace-master': 'startRotate' } as const;
type FlowKind = keyof typeof FLOWS;

const isFlow = (kind: string): kind is FlowKind => Object.hasOwn(FLOWS, kind);

/** The screens that show or ask for the words: the window is secure while one is up. */
const WORDS_SCREENS: ReadonlySet<Screen['screen']> = new Set(['show-words', 'confirm-words', 'enter-words']);

/** Why a flow could not start, in the words the page shows. */
export function flowRefusal(kind: FlowKind, error: unknown): string {
  switch (code(error)) {
    case 'NoBiometrics':
      return 'This phone keeps your master key only behind a fingerprint or face unlock, and none is set up. Set one up in the phone’s settings, then try again.';
    case 'WeakProtection':
      return kind === 'create'
        ? 'You chose not to keep your master key on this phone, so no identity was made.'
        : 'You chose not to keep your master key on this phone, so nothing was changed.';
    case 'AlreadyJoined':
      return 'This phone is one of your devices already. It makes or restores an identity only while it is in none.';
    case 'NoIdentity':
      return 'This phone is not one of your devices yet, so it has no master key to replace.';
    case 'Unavailable':
      return 'Your identity store did not answer, so nothing was kept. Try again when this phone is online.';
    default:
      return reason(error);
  }
}

/** Why the page would not show the words: the window could not be kept out of screenshots. */
export const NOT_SECURE =
  'This phone could not keep the screen out of screenshots and the recent apps, so your 12 words are neither shown nor asked for here.';

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

/** The transport, and what the page calls when it goes without Cancel or Done. */
export interface PhoneTransport extends IdentityTransport {
  /**
   * The page goes another way (back, or the app leaves it): the flow and the link end, and the mark
   * goes. The page is emptied before this is called, so no word is in it when the mark goes.
   */
  gone(): Promise<void>;
}

export function phoneTransport(start: PhoneStart, deps: PhoneTransportDeps): PhoneTransport {
  const { plugin } = deps;
  /** The holder link `scan-device` runs, while it runs. */
  let link: string | null = null;
  let cancelled = false;
  /** The last screen's name only: a screen of the words is never held here. */
  let last: Screen['screen'] | null = null;
  /** The request `answer-request` shows, and the device `revoke` and `rename` act on. */
  let request: (Screen & { screen: 'request' }) | null = null;
  let device: PhoneDeviceView | null = null;
  /** The plugin's make, restore or replace while it runs, by its id. */
  let flow: string | null = null;
  /** Whether the window is marked secure now. */
  let secure = false;

  const failed = (message: string): Screen => ({ screen: 'failed', message });

  /** Marks the window secure, or clears it, once the plugin says it is so. */
  async function setSecure(on: boolean): Promise<void> {
    if (secure === on) return;
    await plugin.setSecure({ on });
    secure = on;
  }

  /** Ends the flow that runs, if one does: the plugin wipes the words it holds. */
  async function endFlow(): Promise<void> {
    const open = flow;
    flow = null;
    if (open) await plugin.identityCancel({ flow: open }).catch(() => undefined);
  }

  /** Ends the holder link that runs, if one does. */
  async function endLink(): Promise<void> {
    cancelled = true;
    const open = link;
    link = null;
    if (open) await plugin.linkCancel({ link: open }).catch(() => undefined);
  }

  /** The window's screen for the plugin's. No DID but on `identity-ready`, where it is made. */
  function flowScreen(screen: IdentityScreen): Screen {
    switch (screen.screen) {
      case 'name-device':
        return { screen: 'name-device', name: deps.hint ?? 'Phone' };
      case 'make-stopped':
        return { screen: 'make-stopped', reason: screen.reason, pending: screen.pending };
      case 'identity-ready':
        return { screen: 'identity-ready', did: screen.did, keyId: screen.keyId, note: screen.note };
      default:
        return screen;
    }
  }

  /** Starts the make, restore or replace: the window is secure before any word exists. */
  async function startFlow(kind: FlowKind): Promise<Screen> {
    const status = await plugin.status();
    if (!status.keys) await plugin.create();
    try {
      await setSecure(true);
    } catch {
      return failed(NOT_SECURE);
    }
    let started: IdentityFlowStart;
    try {
      started = await plugin[FLOWS[kind]]();
    } catch (error) {
      // The plugin made no word: the mark goes, as it was before the flow.
      await setSecure(false).catch(() => undefined);
      return failed(flowRefusal(kind, error));
    }
    if (!started.ended) flow = started.flow;
    return flowScreen(started.screen);
  }

  /** Answers the flow's screen. A refusal other than `WrongInput` has ended the flow. */
  async function flowStep(input: IdentityInput): Promise<Screen> {
    if (!flow) return failed('That step is over. Start it again from Settings.');
    try {
      const next = await plugin.identityStep({ flow, input });
      if (next.ended) flow = null;
      return flowScreen(next.screen);
    } catch (error) {
      if (code(error) !== 'WrongInput') flow = null;
      return failed(reason(error));
    }
  }

  /**
   * Draws `screen` once the window is as secure as it needs: on while it shows or asks for the
   * words. It is never cleared here: the window draws `screen` after this answers, so the words are
   * still in the page now; `leaving` clears it. A window that could not be made secure shows no
   * words: the flow ends.
   */
  async function shown(screen: Screen): Promise<Screen> {
    let drawn = screen;
    if (WORDS_SCREENS.has(screen.screen)) {
      try {
        await setSecure(true);
      } catch {
        await endFlow();
        drawn = failed(NOT_SECURE);
      }
    }
    last = drawn.screen;
    return drawn;
  }

  /**
   * Leaves the page: no flow left running, and the window no longer secure. The window has blanked
   * its screen before it calls `cancel` or `finish`, so no word is in the page when the mark goes.
   */
  async function leaving(outcome: PhoneOutcome): Promise<void> {
    await endFlow();
    await setSecure(false).catch(() => undefined);
    deps.leave(outcome);
  }

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
    if (status.identity) return failed('This phone is one of your devices already.');
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
        return isFlow(start.kind) ? startFlow(start.kind) : failed(ON_A_COMPUTER);
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
          const message = code(error) === 'NeedsWords' ? ANSWER_ON_A_COMPUTER : reason(error);
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
        if (input.rotate) return { ...confirm, error: ROTATE_AFTER };
        try {
          await plugin.revoke({ keyIds: [device.keyId] });
        } catch (error) {
          return { ...confirm, error: code(error) === 'NeedsWords' ? ROTATE_AFTER : reason(error) };
        }
        // The entry that revoked it, as the log now lists it.
        const keyId = device.keyId;
        const { devices } = await plugin.devices();
        const seq = devices.find((d) => d.keyId === keyId)?.revokedSeq ?? null;
        if (seq === null) return failed(`The store does not list ${keyId} as revoked yet. Look again in a moment.`);
        return { screen: 'revoked', keyId, seq };
      }
      case 'words-written':
        return flowStep({ input: 'words-written' });
      case 'words':
        return flowStep({ input: 'confirm-words', first: input.answers[0], second: input.answers[1] });
      case 'name-device':
        return flowStep(input.name ? { input: 'name-device', name: input.name } : { input: 'name-device' });
      case 'twelve-words':
        return flowStep({ input: 'twelve-words', words: input.words });
      case 'lock-out':
        return flowStep({
          input: 'lock-out',
          keyIds: input.keyIds,
          ...(input.name ? { name: input.name } : {}),
        });
      case 'try-again':
        return flowStep({ input: 'try-again' });
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
      await endLink();
      await leaving('cancelled');
      // A phone joins with its own key and claims nothing: its cancel always ends the step.
      return null;
    },
    finish() {
      return leaving(last === 'failed' ? 'failed' : 'done');
    },
    async gone() {
      await endLink();
      await endFlow();
      await setSecure(false).catch(() => undefined);
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
