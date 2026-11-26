/**
 * The identity window: its own bundle and the only page that may run an identity flow, in the Tauri
 * app and the Electron app alike. It draws the custody service's screens and sends back what the
 * person typed; the custody service, behind the shell's main process, holds every secret and does
 * every signing and network call. Each host gives it an `IdentityTransport` and nothing else.
 *
 * Plain DOM with `textContent` only — no template engine, no `innerHTML` — so the window's CSP can
 * forbid every script but its own and every string sink (`require-trusted-types-for 'script'`).
 * Fields are cleared once their call returns, except the 12 words: a refused phrase stays in its
 * fields so the person corrects the word named, and they are cleared once any other screen comes.
 */
import '@we/tokens/css/color';
import 'virtual:we-identity-theme.css';
import './identity.css';

import {
  BOT_ACTIONS,
  BOT_DAYS_DEFAULT,
  BOT_DAYS_MAX,
  deviceMatchActions,
  deviceMatchNote,
  type DeviceNoun,
  heading,
  isLast,
  oneAtATime,
  refusedField,
  remaining,
  type Screen,
  screenTurns,
  sinceMs,
  spreadWords,
  type StepInput,
  targetLine,
  wordNumber,
} from './screens';

/**
 * How the window reaches the custody service: the four calls the host's main process answers for
 * this window only. `start` runs the step the main window opened it on; the window cannot choose.
 */
export interface IdentityTransport {
  start(): Promise<Screen>;
  step(input: StepInput): Promise<Screen>;
  /**
   * Ends the step and closes the window: `null`. A step that could not be ended (a new device that had
   * already joined, a cancel the identity service did not confirm) answers the screen to show instead,
   * and the window stays.
   */
  cancel(): Promise<Screen | null>;
  /** Closes the window after the step's last screen. */
  finish(): Promise<void>;
  /**
   * Reads a QR code with the device's camera: the text of one that starts with `prefix`, or `null`
   * when the person closed the camera. Rejects with why the camera could not be used. Absent where
   * there is none to use (the desktop): the window then offers only the field to paste into.
   */
  scan?(prefix: string): Promise<string | null>;
  /**
   * What this device is, in the words a person reads on the screens that speak of it ("This phone
   * is linked"). Absent means a computer: the desktop windows.
   */
  deviceNoun?: DeviceNoun;
}

let host: IdentityTransport;
let root: HTMLElement;
let offerTimer: number | undefined;
/** The 12 word fields while the words entry is up, so a refusal keeps what was typed. */
let wordFields: HTMLInputElement[] | null = null;
/**
 * The "missing since" the person last sent, and for which devices, drawn again when the custody
 * service answers with a screen that revokes the same devices (a wrong passphrase, a refused time,
 * the retry of a revoke a rotation left): a retry without it would revoke from now, and a revocation
 * cannot be redone. Kept under the devices (`devicesKey`) on every screen, a revoke's and a
 * restore's alike, so the retry finds it.
 */
let picked: { key: string; value: string } | undefined;

/** Where a time picked for revoking the device keys `keyIds` is kept: the same set, in any order. */
function devicesKey(keyIds: string[]): string {
  return [...keyIds].sort().join(' ');
}

/**
 * The "missing since" picker, filled with what the person sent last for `key` when it is drawn again.
 * "Leave empty for now" is said only while it starts empty: a filled one is a time to correct.
 */
function sincePicker(key: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const input = el('input', { type: 'datetime-local' });
  if (picked?.key === key) input.value = picked.value;
  const text = input.value ? 'Missing since' : 'Missing since (leave empty for now)';
  return { label: el('label', {}, text, input), input };
}

/** The picker's time in ms: `undefined` for now, `null` (after saying so) for a time not finished. */
function pickedSince(input: HTMLInputElement, key: string, again: () => void): number | undefined | null {
  const at = sinceMs(input.value, input.validity.badInput);
  if (at === null) again();
  else picked = { key, value: input.value };
  return at;
}

/** What a time not finished says. */
const HALF_TIME = 'Enter the whole date and time, or clear it to revoke from now.';

/**
 * An error line a screen sets in place. A time not finished is said here and the form is never drawn
 * again for it: a redraw would rebuild every tick, the name and the passphrase from the screen the
 * service sent, and a device the person unticked would be ticked again.
 */
function errorSlot(text: string | null): { line: HTMLParagraphElement; show: (message: string) => void } {
  const line = el('p', { className: 'error', textContent: text ?? '' });
  line.hidden = !text;
  return {
    line,
    show: (message) => {
      line.textContent = message;
      line.hidden = false;
    },
  };
}
/** Marked at each screen drawn and each step sent: a wait's answer is drawn only while it holds. */
const turn = screenTurns();

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<'className' | 'type' | 'textContent' | 'autocomplete' | 'placeholder', string>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'className') node.className = value;
    else if (key === 'textContent') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

/** A button whose handler may be a step: `run` draws its outcome, failures included. */
function button(label: string, onClick: () => unknown, kind: 'primary' | 'danger' | '' = ''): HTMLButtonElement {
  const b = el('button', { className: kind, type: 'button', textContent: label });
  b.addEventListener('click', () => void onClick());
  return b;
}

function secretField(label: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const input = el('input', { type: 'password', autocomplete: 'off' });
  return { label: el('label', {}, label, input), input };
}

/** Runs a call, draws the screen it answers, and clears the fields it read. */
async function run(call: () => Promise<Screen>, clear: HTMLInputElement[] = []) {
  turn.mark();
  for (const b of Array.from(root.querySelectorAll('button'))) b.disabled = true;
  try {
    draw(await call());
  } catch (error) {
    draw({ screen: 'failed', message: String(error) });
  } finally {
    for (const input of clear) input.value = '';
  }
}

const step = (input: StepInput, clear: HTMLInputElement[] = []) => run(() => host.step(input), clear);
/*
  Cancel and Done close the window through the host. Where the host cannot be reached (its custody
  service has stopped), the window says so and closes itself, rather than leaving a button that does
  nothing and a window the person has to close by hand. A cancel that could not end the step answers
  the screen to show instead, and the window stays on it. While a cancel is out the window's buttons
  are off, and a second click answers the cancel already sent rather than sending another.
*/
async function leave(call: () => Promise<Screen | null | void>) {
  try {
    const instead = await call();
    if (instead) draw(instead);
  } catch (error) {
    draw({ screen: 'failed', message: String(error) });
    window.close();
  }
}
const cancel = oneAtATime(() => {
  turn.mark();
  for (const b of Array.from(root.querySelectorAll('button'))) b.disabled = true;
  return leave(() => host.cancel());
});
const finish = () => void leave(() => host.finish());

function textField(label: string, value = '', placeholder = ''): { label: HTMLLabelElement; input: HTMLInputElement } {
  const input = el('input', { type: 'text', autocomplete: 'off', placeholder });
  input.value = value;
  return { label: el('label', {}, label, input), input };
}

/** The trimmed text of `input`, or nothing when it is blank. */
function typed(input: HTMLInputElement | null): string | undefined {
  const text = input?.value.trim();
  return text ? text : undefined;
}

/**
 * A code or link the other device needs, as a QR code and as text with a copy button, and how long it
 * still works.
 */
function shareable(text: string, qrSvg: string, alt: string, expires: number, waiting: string): Child[] {
  const qr = el('img', { className: 'qr' });
  qr.alt = alt;
  qr.src = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;
  return [
    qr,
    el('div', { className: 'link', textContent: text }),
    el(
      'div',
      { className: 'row' },
      button('Copy link', () => void navigator.clipboard?.writeText(text)),
      button('Cancel', cancel),
    ),
    countdown(expires, waiting),
  ];
}

/** "Single use · Expires in 4:52 · Waiting…", ticking. */
function countdown(expires: number, waiting: string): HTMLParagraphElement {
  const left = el('p', { className: 'note' });
  const tick = () =>
    (left.textContent = `Single use · Expires in ${remaining(expires, Date.now() / 1000)} · ${waiting}`);
  tick();
  offerTimer = window.setInterval(tick, 1000);
  return left;
}

/**
 * Asks the custody service to wait for what the other device does next, once this screen is drawn,
 * leaving the buttons live so the person can still copy or cancel while it waits. Its answer is
 * dropped once another screen was drawn or a step sent (`screenTurns`).
 */
function waitFor(input: StepInput) {
  queueMicrotask(() => {
    const current = turn.hold();
    void host.step(input).then(
      (screen) => current() && draw(screen),
      (error: unknown) => current() && draw({ screen: 'failed', message: String(error) }),
    );
  });
}

function errorLine(error: string | null): Child[] {
  return error ? [el('p', { className: 'error', textContent: error })] : [];
}

/**
 * The 12 word fields, numbered as the words grid numbers them. A whole phrase pasted into any field
 * spreads over the fields from there. The words never leave the fields but in the step that sends
 * them.
 */
function wordsEntry(position: number | null): { fields: HTMLInputElement[]; grid: HTMLElement } {
  const fields =
    wordFields ??
    Array.from({ length: 12 }, (_, i) => {
      const input = el('input', { type: 'text', autocomplete: 'off' });
      input.spellcheck = false;
      input.setAttribute('autocapitalize', 'none');
      input.setAttribute('aria-label', `Word ${i + 1}`);
      return input;
    });
  fields.forEach((input, i) => {
    input.onpaste = (event) => {
      const spread = spreadWords(event.clipboardData?.getData('text') ?? '', i);
      if (!spread.length) return;
      event.preventDefault();
      for (const [at, word] of spread) fields[at].value = word;
    };
    // `aria-invalid` is a token, not a boolean attribute: present and empty would mean "true" to some
    // readers and nothing to others, so the refused field says "true" and the others carry none.
    if (refusedField(position, i)) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  });
  wordFields = fields;
  const grid = el(
    'div',
    { className: 'words' },
    ...fields.map((input, i) =>
      el('label', { className: 'word' }, el('span', { className: 'n', textContent: wordNumber(i) }), input),
    ),
  );
  return { fields, grid };
}

/** Empties the word fields and lets them go. */
function forgetWords() {
  for (const input of wordFields ?? []) input.value = '';
  wordFields = null;
}

/** Who asks, as both devices show it: the request's code, and the asking key from the key log. */
function whoAsks(screen: { keyId: string; fingerprint: string; code: string }): Child[] {
  return [
    el('div', { className: 'code', textContent: screen.code }),
    el('p', { className: 'note', textContent: `${screen.keyId} · key ${screen.fingerprint}` }),
  ];
}

/**
 * The code field's scan button, where the host has a camera: what it reads goes into `field` and is
 * sent as if typed. Why the camera could not be used shows under the field, which stays usable.
 */
function scanInto(prefix: string, field: HTMLInputElement, go: () => unknown): { buttons: Child[]; problem: Child[] } {
  const scan = host.scan?.bind(host);
  if (!scan) return { buttons: [], problem: [] };
  const problem = el('p', { className: 'error' });
  problem.hidden = true;
  const read = async () => {
    problem.hidden = true;
    try {
      const text = await scan(prefix);
      if (text === null) return;
      field.value = text;
      await go();
    } catch (error) {
      problem.textContent = error instanceof Error ? error.message : String(error);
      problem.hidden = false;
    }
  };
  return { buttons: [button('Scan code', read, 'primary')], problem: [problem] };
}

function body(screen: Screen): Child[] {
  switch (screen.screen) {
    case 'show-words': {
      const understood = el('input', { type: 'checkbox' });
      const next = button('Continue', () => step({ kind: 'words-written' }), 'primary');
      next.disabled = true;
      understood.addEventListener('change', () => (next.disabled = !understood.checked));
      return [
        el(
          'div',
          { className: 'words' },
          ...screen.words.map((w, i) =>
            el('div', { className: 'word' }, el('span', { className: 'n', textContent: wordNumber(i) }), w),
          ),
        ),
        el('p', {
          className: 'note',
          textContent: "Don't take a screenshot or save them in a password manager that syncs.",
        }),
        el(
          'label',
          { className: 'check' },
          understood,
          "I understand that no one can restore my identity without these words, not even the app's developers.",
        ),
        el('div', { className: 'row' }, next, button('Cancel', cancel)),
      ];
    }
    case 'confirm-words': {
      const [a, b] = screen.positions;
      const first = el('input', { type: 'text', autocomplete: 'off', placeholder: `Type word ${a}` });
      const second = el('input', { type: 'text', autocomplete: 'off', placeholder: `Type word ${b}` });
      const confirm = () => step({ kind: 'words', answers: [first.value, second.value] }, [first, second]);
      return [
        el('label', {}, `Word ${a}`, first),
        el('label', {}, `Word ${b}`, second),
        ...errorLine(screen.error),
        el('div', { className: 'row' }, button('Confirm', confirm, 'primary'), button('Cancel', cancel)),
      ];
    }
    case 'set-passphrase': {
      const p = secretField('Passphrase (at least 15 characters)');
      const again = secretField('Confirm passphrase');
      const go = () =>
        step({ kind: 'passphrase', passphrase: p.input.value, confirm: again.input.value }, [p.input, again.input]);
      return [
        p.label,
        again.label,
        ...errorLine(screen.error),
        el('div', { className: 'row' }, button('Continue', go, 'primary'), button('Cancel', cancel)),
      ];
    }
    case 'enter-passphrase': {
      const p = secretField('Passphrase');
      const go = () => step({ kind: 'passphrase', passphrase: p.input.value }, [p.input]);
      return [
        p.label,
        ...errorLine(screen.error),
        el('div', { className: 'row' }, button('Unlock', go, 'primary'), button('Cancel', cancel)),
      ];
    }
    case 'offer':
      // The claim can come at any moment: wait for it now.
      waitFor({ kind: 'wait-claim' });
      return shareable(screen.link, screen.qrSvg, 'QR code for the link', screen.expires, 'Waiting for your device…');
    case 'enter-code': {
      const code = textField('Code', '', 'Paste the link from the new device');
      const go = () => step({ kind: 'code', code: code.input.value.trim() }, [code.input]);
      const scan = scanInto('coasys:device:1:', code.input, go);
      return [
        code.label,
        ...errorLine(screen.error),
        ...scan.problem,
        el(
          'div',
          { className: 'row' },
          ...scan.buttons,
          button('Continue', go, scan.buttons.length ? '' : 'primary'),
          button('Cancel', cancel),
        ),
      ];
    }
    case 'enter-offer': {
      const link = textField('Link', '', 'coasys:offer:1:…');
      const host = screen.host === undefined ? null : textField('Host address', screen.host, 'https://…');
      if (host) host.input.type = 'url';
      const go = () =>
        step({ kind: 'offer', link: link.input.value.trim(), ...(host ? { host: host.input.value.trim() } : {}) }, [
          link.input,
        ]);
      const scan = scanInto('coasys:offer:1:', link.input, go);
      return [
        link.label,
        ...(host ? [host.label] : []),
        ...errorLine(screen.error),
        ...scan.problem,
        el(
          'div',
          { className: 'row' },
          ...scan.buttons,
          button('Continue', go, scan.buttons.length ? '' : 'primary'),
          button('Not now', cancel),
        ),
      ];
    }
    case 'code-sent':
      waitFor({ kind: 'wait-claim' });
      return [
        el('div', { className: 'row' }, button('Cancel', cancel)),
        countdown(screen.expires, 'Waiting for your device…'),
      ];
    case 'device-code':
      // A device of the identity can link this one at any moment: wait for it now.
      waitFor({ kind: 'wait-link' });
      return shareable(
        screen.code,
        screen.qrSvg,
        `QR code for this ${host.deviceNoun ?? 'computer'}`,
        screen.expires,
        'Waiting for your other device…',
      );
    case 'device-match': {
      const actions = deviceMatchActions(screen);
      if (actions.wait) waitFor({ kind: 'wait-join' });
      const note = deviceMatchNote(screen);
      const accept = actions.accept ? [button('Confirm', () => step({ kind: 'accept' }), 'primary')] : [];
      return [
        ...(screen.notice ? [el('p', { className: 'error', textContent: screen.notice })] : []),
        el('div', { className: 'code', textContent: screen.code }),
        el('div', { className: 'link', textContent: screen.did }),
        ...(note ? [el('p', { className: 'note', textContent: note })] : []),
        el('div', { className: 'row' }, ...accept, button('Cancel', cancel)),
      ];
    }
    case 'match': {
      const name = textField('Device name', screen.hint ?? '', 'Work laptop');
      const own = screen.ownName ? textField('Name for this computer', '', 'Home desktop') : null;
      const keep = screen.canKeep ? el('input', { type: 'checkbox' }) : null;
      const confirm = () =>
        step({
          kind: 'confirm',
          name: typed(name.input),
          keepMaster: keep?.checked ?? false,
          thisName: typed(own?.input ?? null),
        });
      return [
        el('div', { className: 'code', textContent: screen.code }),
        name.label,
        ...(own ? [own.label] : []),
        ...(keep
          ? [
              el('label', { className: 'check' }, keep, 'Send it the master key'),
              el('p', {
                className: 'note',
                textContent: 'It can then add and remove devices. Choose this only for a device you keep safe.',
              }),
            ]
          : []),
        el('p', { textContent: 'It will be able to:' }),
        el(
          'ul',
          {},
          el('li', { textContent: 'Post, send messages and edit as you' }),
          el('li', { textContent: 'Join your spaces' }),
        ),
        el('p', { className: 'note', textContent: 'Only link a device you own or have with you.' }),
        el('div', { className: 'row' }, button('Link', confirm, 'primary'), button('Deny', cancel)),
      ];
    }
    case 'request': {
      const p = screen.passphrase ? secretField('Passphrase') : null;
      const go = () => step({ kind: 'answer', ...(p ? { passphrase: p.input.value } : {}) }, p ? [p.input] : []);
      const yes = screen.kind === 'send-master' ? button('Send', go, 'primary') : button('Remove', go, 'danger');
      return [
        ...whoAsks(screen),
        ...(screen.kind === 'confirm-revoke'
          ? [el('ul', {}, ...screen.targets.map((t) => el('li', { textContent: targetLine(t) })))]
          : []),
        ...(p ? [p.label] : []),
        ...errorLine(screen.error),
        el('p', { className: 'note', textContent: 'Not now keeps the request open until it expires.' }),
        el('div', { className: 'row' }, yes, button('Not now', cancel)),
      ];
    }
    case 'rename': {
      const name = textField('Name', screen.name);
      const go = () => step({ kind: 'name', name: name.input.value.trim() });
      return [
        name.label,
        ...errorLine(screen.error),
        el('div', { className: 'row' }, button('Save', go, 'primary'), button('Cancel', cancel)),
      ];
    }
    case 'unlink-confirm': {
      const p = screen.passphrase ? secretField('Passphrase') : null;
      const go = () => step({ kind: 'unlink', ...(p ? { passphrase: p.input.value } : {}) }, p ? [p.input] : []);
      return [
        ...(p ? [p.label] : []),
        ...errorLine(screen.error),
        el('div', { className: 'row' }, button('Unlink', go, 'primary'), button('Cancel', cancel)),
      ];
    }
    case 'revoke-confirm': {
      const p = screen.passphrase ? secretField('Passphrase') : null;
      const since = sincePicker(devicesKey([screen.keyId]));
      const problem = errorSlot(screen.error);
      const rotate = el('input', { type: 'checkbox' });
      rotate.checked = screen.rotate;
      // With "Also replace master key" the rotation comes first and the revoke follows it, from the
      // same time: the picker stays.
      const go = () => {
        const at = pickedSince(since.input, devicesKey([screen.keyId]), () => problem.show(HALF_TIME));
        if (at === null) return;
        void step(
          {
            kind: 'revoke',
            rotate: rotate.checked,
            ...(p ? { passphrase: p.input.value } : {}),
            ...(at === undefined ? {} : { since: at }),
          },
          p ? [p.input] : [],
        );
      };
      // What replacing the master key adds, said only while it is ticked: unticked, no phrase is asked.
      const rotateNote = el('p', {
        className: 'note',
        textContent:
          "Any copy this device has stops working. You'll enter your recovery phrase next, and the device is revoked from the time above after your master key is replaced.",
      });
      rotateNote.hidden = !rotate.checked;
      rotate.addEventListener('change', () => (rotateNote.hidden = !rotate.checked));
      return [
        since.label,
        el('label', { className: 'check' }, rotate, 'Also replace master key'),
        rotateNote,
        ...(p ? [p.label] : []),
        problem.line,
        el('div', { className: 'row' }, button('Revoke', go, 'danger'), button('Cancel', cancel)),
      ];
    }
    case 'enter-words': {
      const { fields, grid } = wordsEntry(screen.position);
      const go = () => step({ kind: 'twelve-words', words: fields.map((f) => f.value.trim()).join(' ') });
      return [
        grid,
        ...errorLine(screen.error),
        el('div', { className: 'row' }, button('Continue', go, 'primary'), button('Cancel', cancel)),
      ];
    }
    case 'restore-devices': {
      const ticks = screen.devices.map((d) => {
        const box = el('input', { type: 'checkbox' });
        box.checked = d.lockOut;
        return { keyId: d.keyId, box, label: d.name ? `${d.name} (${d.keyId})` : d.keyId };
      });
      const name = textField('Name for this computer', '', 'Home desktop');
      // Drawn for the devices ticked to start with, which is how the service sends the screen again.
      const since = sincePicker(devicesKey(screen.devices.filter((d) => d.lockOut).map((d) => d.keyId)));
      const problem = errorSlot(null);
      const go = () => {
        const keyIds = ticks.filter((t) => t.box.checked).map((t) => t.keyId);
        const at = pickedSince(since.input, devicesKey(keyIds), () => problem.show(HALF_TIME));
        if (at === null) return;
        void step({
          kind: 'lock-out',
          keyIds,
          name: typed(name.input),
          ...(at === undefined ? {} : { since: at }),
        });
      };
      return [
        el('div', { className: 'link', textContent: screen.did }),
        ...ticks.map((t) => el('label', { className: 'check' }, t.box, `Remove ${t.label}`)),
        since.label,
        name.label,
        problem.line,
        el('div', { className: 'row' }, button('Restore', go, 'primary'), button('Cancel', cancel)),
      ];
    }
    case 'remove-master':
      return [
        ...errorLine(screen.error),
        el(
          'div',
          { className: 'row' },
          button('Remove', () => step({ kind: 'remove' }), 'danger'),
          button('Cancel', cancel),
        ),
      ];
    case 'bot-scope': {
      const ticks = BOT_ACTIONS.map(({ action, label }) => {
        const box = el('input', { type: 'checkbox' });
        box.checked = action === 'read';
        return { action, box, label };
      });
      const days = el('input', { type: 'number', autocomplete: 'off' });
      days.min = '1';
      days.max = String(BOT_DAYS_MAX);
      days.value = String(BOT_DAYS_DEFAULT);
      const go = () =>
        step({
          kind: 'bot-scope',
          can: ticks.filter((t) => t.box.checked).map((t) => t.action),
          days: Number(days.value),
        });
      return [
        el('p', { textContent: 'Permissions' }),
        ...ticks.map((t) => el('label', { className: 'check' }, t.box, t.label)),
        el('label', {}, `Days (1 to ${BOT_DAYS_MAX})`, days),
        el('p', {
          className: 'note',
          textContent: 'This is the most it can ever do. To change it, add the bot again.',
        }),
        ...errorLine(screen.error),
        el('div', { className: 'row' }, button('Continue', go, 'primary'), button('Cancel', cancel)),
      ];
    }
    case 'bot-offer':
      // The bot can claim at any moment: wait for it now.
      waitFor({ kind: 'wait-claim' });
      return [
        el('div', { className: 'link', textContent: screen.offer }),
        el(
          'div',
          { className: 'row' },
          button('Copy code', () => void navigator.clipboard?.writeText(screen.offer), 'primary'),
          button('Cancel', cancel),
        ),
        el('p', {
          className: 'note',
          textContent: 'Anyone with this code can create a bot for you. Paste it only where your bot runs.',
        }),
        countdown(screen.expires, 'Waiting for the bot…'),
      ];
    case 'bot-match': {
      const name = textField('Name', screen.name ?? '', 'Meeting notes bot');
      const confirm = () => step({ kind: 'confirm', name: typed(name.input) });
      return [
        el('div', { className: 'code', textContent: screen.code }),
        name.label,
        el('p', { className: 'note', textContent: 'Only add a bot you run yourself.' }),
        el('div', { className: 'row' }, button('Add', confirm, 'primary'), button('Cancel', cancel)),
      ];
    }
    case 'bot-added':
      return [];
    case 'master-not-kept':
      // The rotation stands: closing leaves it, and trying again needs the words once more.
      return [
        el(
          'div',
          { className: 'row' },
          button('Enter recovery phrase', () => step({ kind: 'try-again' }), 'primary'),
          button('Close', cancel),
        ),
      ];
    case 'rotated-not-revoked': {
      // The rotation stands: closing leaves it; trying again publishes only the revoke.
      const since = sincePicker(devicesKey(screen.keyIds));
      const problem = errorSlot(null);
      const go = () => {
        const at = pickedSince(since.input, devicesKey(screen.keyIds), () => problem.show(HALF_TIME));
        if (at === null) return;
        void step({ kind: 'retry-revoke', ...(at === undefined ? {} : { since: at }) });
      };
      return [
        since.label,
        problem.line,
        el('div', { className: 'row' }, button('Revoke now', go, 'primary'), button('Close', cancel)),
      ];
    }
    case 'restore-not-linked':
      return [
        el('div', { className: 'link', textContent: screen.did }),
        el(
          'div',
          { className: 'row' },
          button('Try again', () => step({ kind: 'try-again' }), 'primary'),
          button('Close', cancel),
        ),
      ];
    case 'restored':
      return [el('div', { className: 'link', textContent: screen.did })];
    case 'master-replaced':
    case 'master-removed':
      return [];
    case 'pending-refused':
      return [
        el('div', { className: 'link', textContent: screen.did }),
        el(
          'div',
          { className: 'row' },
          button('Discard', () => step({ kind: 'discard' }), 'danger'),
          button('Cancel', cancel),
        ),
      ];
    case 'identity-ready':
      return [
        el('div', { className: 'link', textContent: screen.did }),
        el('p', { className: 'note', textContent: `Listed as ${screen.keyId} in your key log.` }),
      ];
    case 'joined':
    case 'master-taken':
      return [el('div', { className: 'link', textContent: screen.did })];
    case 'asked':
      return whoAsks(screen);
    case 'linked':
    case 'unlinked':
    case 'revoked':
    case 'request-answered':
    case 'renamed':
    case 'failed':
      return [];
  }
}

function draw(screen: Screen) {
  turn.mark();
  if (offerTimer !== undefined) {
    window.clearInterval(offerTimer);
    offerTimer = undefined;
  }
  if (screen.screen !== 'enter-words') forgetWords();
  const { title, lead } = heading(screen, host.deviceNoun);
  const parts: Child[] = [el('h1', { textContent: title }), el('p', { textContent: lead }), ...body(screen)];
  if (isLast(screen)) parts.push(el('div', { className: 'row' }, button('Done', finish, 'primary')));
  root.replaceChildren(...parts);
  // A refused word's field first, else the first field.
  (
    root.querySelector<HTMLInputElement>('input[aria-invalid="true"]') ??
    root.querySelector<HTMLInputElement>('input:not([type=checkbox])')
  )?.focus();
}

/** Draws the window into this page and starts its step. */
export function runIdentityWindow(transport: IdentityTransport): void {
  host = transport;
  root = el('main', {});
  root.id = 'screen';
  root.setAttribute('aria-live', 'polite');
  const mark = el('span', { className: 'mark' });
  mark.setAttribute('aria-hidden', 'true');
  document.body.replaceChildren(
    el(
      'header',
      { className: 'brand' },
      mark,
      // The app's own name is the window's title, which the host sets; the page names no app.
      el('strong', { textContent: 'Identity' }),
    ),
    root,
  );
  void run(() => host.start());
}
