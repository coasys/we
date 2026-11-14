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
import '@we/tokens/css';
import 'virtual:we-identity-theme.css';
import './identity.css';

import brand from 'virtual:we-identity-brand';

import {
  blankedBefore,
  BOT_ACTIONS,
  BOT_DAYS_DEFAULT,
  BOT_DAYS_MAX,
  deviceMatchActions,
  deviceMatchNote,
  type DeviceNoun,
  heading,
  isLast,
  oneAtATime,
  type PageFrames,
  painted,
  refusedField,
  remaining,
  type Screen,
  spreadWords,
  type StepInput,
  targetLine,
  turns,
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
   * and the window stays. The window's screen is blank, and drawn so, before this is called.
   */
  cancel(): Promise<Screen | null>;
  /** Closes the window after the step's last screen. The screen is blank before this is called. */
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
/** Whose answer is drawn: a cancel ends the turn of the step it cancels. */
const answers = turns();

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

/**
 * Runs a call, draws the screen it answers, and clears the fields it read. The buttons are off while
 * it runs, but those in `live`. An answer that comes after a cancel is not drawn.
 */
async function run(call: () => Promise<Screen>, clear: HTMLInputElement[] = [], live: HTMLButtonElement[] = []) {
  for (const b of Array.from(root.querySelectorAll('button'))) if (!live.includes(b)) b.disabled = true;
  const current = answers.take();
  try {
    const screen = await call();
    if (current()) draw(screen);
  } catch (error) {
    if (current()) draw({ screen: 'failed', message: String(error) });
  } finally {
    for (const input of clear) input.value = '';
  }
}

const step = (input: StepInput, clear: HTMLInputElement[] = [], live: HTMLButtonElement[] = []) =>
  run(() => host.step(input), clear, live);
/*
  Cancel and Done close the window through the host. Where the host cannot be reached (its custody
  service has stopped), the window says so and closes itself, rather than leaving a button that does
  nothing and a window the person has to close by hand. A cancel that could not end the step answers
  the screen to show instead, and the window stays on it. While a cancel is out the window's buttons
  are off, and a second click answers the cancel already sent rather than sending another. A cancel
  ends the turn of the step that runs: its answer, if one comes, is not drawn.

  Both blank the screen first, and wait for a frame that shows it blank: on the phone the host then
  lets screenshots in again, and the words must not be on the screen then.
*/
function blank() {
  if (offerTimer !== undefined) {
    window.clearInterval(offerTimer);
    offerTimer = undefined;
  }
  forgetWords();
  root.replaceChildren();
}

/** The page's frames, for [`painted`]: a blank screen counts as shown only while the page is. */
const page: PageFrames = {
  hidden: () => document.visibilityState === 'hidden',
  shown(then) {
    const seen = () => {
      if (document.visibilityState === 'hidden') return;
      document.removeEventListener('visibilitychange', seen);
      then();
    };
    document.addEventListener('visibilitychange', seen);
  },
  frame: (then) => void requestAnimationFrame(() => then()),
  after: (ms, then) => void window.setTimeout(then, ms),
};

async function leave(call: () => Promise<Screen | null | void>) {
  try {
    const instead = await blankedBefore(blank, () => painted(page), call);
    if (instead) draw(instead);
  } catch (error) {
    draw({ screen: 'failed', message: String(error) });
    window.close();
  }
}
const cancel = oneAtATime(() => {
  answers.end();
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
      button('Copy the link', () => void navigator.clipboard?.writeText(text)),
      button('Cancel', cancel),
    ),
    countdown(expires, waiting),
  ];
}

/** "Works once, for 4:52 · Waiting…", ticking. */
function countdown(expires: number, waiting: string): HTMLParagraphElement {
  const left = el('p', { className: 'note' });
  const tick = () => (left.textContent = `Works once, for ${remaining(expires, Date.now() / 1000)} · ${waiting}`);
  tick();
  offerTimer = window.setInterval(tick, 1000);
  return left;
}

/**
 * Asks the custody service to wait for what the other device does next, once this screen is drawn,
 * leaving the buttons live so the person can still copy or cancel while it waits.
 */
function waitFor(input: StepInput) {
  const current = answers.take();
  queueMicrotask(() => {
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
      const next = button('I wrote them down', () => step({ kind: 'words-written' }), 'primary');
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
          textContent: 'Avoid screenshots and password managers that sync. Paper in a safe place works best.',
        }),
        el(
          'label',
          { className: 'check' },
          understood,
          'I understand: without these words, nobody can recover my identity or change its keys. Not even the people who made this app.',
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
      const p = secretField('Passphrase — at least 15 characters; spaces count');
      const again = secretField('Type it again');
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
      return shareable(
        screen.link,
        screen.qrSvg,
        'QR code of the offer link',
        screen.expires,
        'Waiting for your device…',
      );
    case 'enter-code': {
      const code = textField('Code', '', 'coasys:device:1:…');
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
        el('p', { textContent: 'It will be able to' }),
        el(
          'ul',
          {},
          el('li', { textContent: 'Sign posts, messages and edits as you' }),
          el('li', { textContent: 'Join your identity’s spaces' }),
        ),
        el('p', { className: 'note', textContent: 'Add only a device you run or have in front of you.' }),
        el('div', { className: 'row' }, button('Add it', confirm, 'primary'), button('Deny', cancel)),
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
    case 'revoke-confirm': {
      const p = screen.passphrase ? secretField('Passphrase') : null;
      const rotate = el('input', { type: 'checkbox' });
      rotate.checked = screen.rotate;
      const go = () =>
        step(
          { kind: 'revoke', rotate: rotate.checked, ...(p ? { passphrase: p.input.value } : {}) },
          p ? [p.input] : [],
        );
      return [
        el('label', { className: 'check' }, rotate, 'Also replace master key'),
        el('p', {
          className: 'note',
          textContent: "Any copy this device has stops working. You'll enter your recovery phrase next.",
        }),
        ...(p ? [p.label] : []),
        ...errorLine(screen.error),
        el('div', { className: 'row' }, button('Remove', go, 'danger'), button('Cancel', cancel)),
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
        return { keyId: d.keyId, box, label: d.name || d.keyId };
      });
      const noun = host.deviceNoun ?? 'computer';
      const name = textField(`Name for this ${noun}`, '', noun === 'phone' ? 'My phone' : 'Home desktop');
      const go = () =>
        step({
          kind: 'lock-out',
          keyIds: ticks.filter((t) => t.box.checked).map((t) => t.keyId),
          name: typed(name.input),
        });
      // No DID here: the person knows the identity by its devices, and sees a DID only where it is made.
      return [
        ...ticks.map((t) => el('label', { className: 'check' }, t.box, `Remove ${t.label}`)),
        name.label,
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
    case 'restore-not-linked':
      return [
        el(
          'div',
          { className: 'row' },
          button('Try again', () => step({ kind: 'try-again' }), 'primary'),
          button('Close', cancel),
        ),
      ];
    case 'name-device': {
      const name = textField('Name', screen.name);
      // On the phone this step can solve the store's proof of work, for a minute or more: Cancel stays
      // live while it runs, and reaches the flow's cancel.
      const stop = button('Cancel', cancel);
      const go = () => step({ kind: 'name-device', name: typed(name.input) }, [], [stop]);
      return [name.label, el('div', { className: 'row' }, button('Continue', go, 'primary'), stop)];
    }
    case 'make-stopped': {
      // Closing leaves a pending identity pending: it is published when the app next opens. The publish
      // tried again can solve the proof of work too, so Close stays live while it runs.
      const close = button('Close', cancel);
      return [
        el(
          'div',
          { className: 'row' },
          button('Try again', () => step({ kind: 'try-again' }, [], [close]), 'primary'),
          close,
        ),
      ];
    }
    case 'restored':
    case 'master-replaced':
    case 'master-removed':
      return [];
    case 'pending-refused':
      return [
        el('div', { className: 'link', textContent: screen.did }),
        el(
          'div',
          { className: 'row' },
          button('Discard it', () => step({ kind: 'discard' }), 'danger'),
          button('Cancel', cancel),
        ),
      ];
    case 'identity-ready':
      return [
        el('div', { className: 'link', textContent: screen.did }),
        el('p', {
          className: 'note',
          textContent: `This ${host.deviceNoun ?? 'computer'} is ${screen.keyId} in your key log.`,
        }),
      ];
    case 'joined':
    case 'master-taken':
      // The identifier is shown once, when the identity is made; a device joining it needs no copy.
      return [];
    case 'asked':
      return whoAsks(screen);
    case 'linked':
    case 'revoked':
    case 'request-answered':
    case 'renamed':
    case 'failed':
      return [];
  }
}

function draw(screen: Screen) {
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
  /*
    The app's mark and name, as its screens before a session draw them, handed in by the host's build.
    A deployment whose app brings none gets a plain mark, and its name stays the window's title.
  */
  const mark = brand?.mark ? el('img', { className: 'mark' }) : el('span', { className: 'mark plain' });
  if (mark instanceof HTMLImageElement && brand?.mark) {
    mark.alt = '';
    mark.src = brand.mark;
  } else mark.setAttribute('aria-hidden', 'true');
  document.body.replaceChildren(
    el('header', { className: 'brand' }, mark, el('strong', { textContent: brand?.name ?? 'Your identity' })),
    root,
  );
  void run(() => host.start());
}
