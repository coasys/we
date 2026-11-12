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
  deviceMatchActions,
  deviceMatchNote,
  heading,
  isLast,
  refusedField,
  remaining,
  type Screen,
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
}

let host: IdentityTransport;
let root: HTMLElement;
let offerTimer: number | undefined;
/** The 12 word fields while the words entry is up, so a refusal keeps what was typed. */
let wordFields: HTMLInputElement[] | null = null;

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
  the screen to show instead, and the window stays on it.
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
const cancel = () => void leave(() => host.cancel());
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
  queueMicrotask(() => {
    void host.step(input).then(draw, (error: unknown) => draw({ screen: 'failed', message: String(error) }));
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
      const code = textField('The new device’s code', '', 'coasys:device:1:…');
      const go = () => step({ kind: 'code', code: code.input.value.trim() }, [code.input]);
      return [
        code.label,
        ...errorLine(screen.error),
        el('div', { className: 'row' }, button('Continue', go, 'primary'), button('Cancel', cancel)),
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
        'QR code of this computer’s code',
        screen.expires,
        'Waiting for your other device…',
      );
    case 'device-match': {
      const actions = deviceMatchActions(screen);
      if (actions.wait) waitFor({ kind: 'wait-join' });
      const note = deviceMatchNote(screen);
      const accept = actions.accept ? [button('This is my identity', () => step({ kind: 'accept' }), 'primary')] : [];
      return [
        el('div', { className: 'code', textContent: screen.code }),
        el('div', { className: 'link', textContent: screen.did }),
        ...(note ? [el('p', { className: 'note', textContent: note })] : []),
        el('div', { className: 'row' }, ...accept, button('Cancel', cancel)),
      ];
    }
    case 'match': {
      const name = textField('Name the new device', screen.hint ?? '', 'Laptop, Office server…');
      const own = screen.ownName ? textField('Name this computer', '', 'Desktop at home…') : null;
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
              el('label', { className: 'check' }, keep, 'Keep the master key on this device'),
              el('p', {
                className: 'note',
                textContent:
                  'Then that device can add and remove your devices too. Choose it only for a device you keep safe.',
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
      const yes =
        screen.kind === 'send-master' ? button('Send it', go, 'primary') : button('Revoke them', go, 'danger');
      return [
        ...whoAsks(screen),
        ...(screen.kind === 'confirm-revoke'
          ? [el('ul', {}, ...screen.targets.map((t) => el('li', { textContent: targetLine(t) })))]
          : []),
        ...(p ? [p.label] : []),
        ...errorLine(screen.error),
        el('p', { className: 'note', textContent: 'Not now leaves the request waiting until it expires.' }),
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
        el('label', { className: 'check' }, rotate, 'Also replace my master key'),
        el('p', {
          className: 'note',
          textContent: 'Then a copy the device kept stops working. You type your 12 words next.',
        }),
        ...(p ? [p.label] : []),
        ...errorLine(screen.error),
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
      const name = textField('Name this computer', '', 'Laptop, Desktop at home…');
      const go = () =>
        step({
          kind: 'lock-out',
          keyIds: ticks.filter((t) => t.box.checked).map((t) => t.keyId),
          name: typed(name.input),
        });
      return [
        el('div', { className: 'link', textContent: screen.did }),
        ...ticks.map((t) => el('label', { className: 'check' }, t.box, `Lock out ${t.label}`)),
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
          button('Remove it', () => step({ kind: 'remove' }), 'danger'),
          button('Keep it', cancel),
        ),
      ];
    case 'master-not-kept':
      // The rotation stands: closing leaves it, and Try again needs the words once more.
      return [
        el(
          'div',
          { className: 'row' },
          button('Type my 12 words again', () => step({ kind: 'try-again' }), 'primary'),
          button('Close', cancel),
        ),
      ];
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
          button('Discard it', () => step({ kind: 'discard' }), 'danger'),
          button('Cancel', cancel),
        ),
      ];
    case 'identity-ready':
      return [
        el('div', { className: 'link', textContent: screen.did }),
        el('p', { className: 'note', textContent: `This computer is ${screen.keyId} in your key log.` }),
      ];
    case 'joined':
    case 'master-taken':
      return [el('div', { className: 'link', textContent: screen.did })];
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
  const { title, lead } = heading(screen);
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
      el('strong', { textContent: 'Your identity' }),
    ),
    root,
  );
  void run(() => host.start());
}
