/**
 * The identity window: its own bundle and the only page that may run an identity flow, in the Tauri
 * app and the Electron app alike. It draws the custody service's screens and sends back what the
 * person typed; the custody service, behind the shell's main process, holds every secret and does
 * every signing and network call. Each host gives it an `IdentityTransport` and nothing else.
 *
 * Plain DOM with `textContent` only — no template engine, no `innerHTML` — so the window's CSP can
 * forbid every script but its own and every string sink (`require-trusted-types-for 'script'`).
 * Fields are cleared once their call returns.
 */
import '@we/tokens/css/color';
import 'virtual:we-identity-theme.css';
import './identity.css';

import { heading, isLast, remaining, type Screen, type StepInput, wordNumber } from './screens';

/**
 * How the window reaches the custody service: the four calls the host's main process answers for
 * this window only. `start` runs the step the main window opened it on; the window cannot choose.
 */
export interface IdentityTransport {
  start(): Promise<Screen>;
  step(input: StepInput): Promise<Screen>;
  /** Ends the step and closes the window. */
  cancel(): Promise<void>;
  /** Closes the window after the step's last screen. */
  finish(): Promise<void>;
}

let host: IdentityTransport;
let root: HTMLElement;
let offerTimer: number | undefined;

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
  nothing and a window the person has to close by hand.
*/
async function leave(call: () => Promise<void>) {
  try {
    await call();
  } catch (error) {
    draw({ screen: 'failed', message: String(error) });
    window.close();
  }
}
const cancel = () => void leave(() => host.cancel());
const finish = () => void leave(() => host.finish());

function errorLine(error: string | null): Child[] {
  return error ? [el('p', { className: 'error', textContent: error })] : [];
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
    case 'offer': {
      const qr = el('img', { className: 'qr' });
      qr.alt = 'QR code for the link';
      qr.src = `data:image/svg+xml;utf8,${encodeURIComponent(screen.qrSvg)}`;
      const left = el('p', { className: 'note' });
      const tick = () =>
        (left.textContent = `Single use · Expires in ${remaining(screen.expires, Date.now() / 1000)} · Waiting for your device…`);
      tick();
      offerTimer = window.setInterval(tick, 1000);
      // The claim can come at any moment: ask the custody service to wait for it now, leaving the
      // buttons live so the person can still copy the link or cancel while it waits.
      queueMicrotask(() => {
        void host
          .step({ kind: 'wait-claim' })
          .then(draw, (error: unknown) => draw({ screen: 'failed', message: String(error) }));
      });
      return [
        qr,
        el('div', { className: 'link', textContent: screen.link }),
        el(
          'div',
          { className: 'row' },
          button('Copy link', () => void navigator.clipboard?.writeText(screen.link)),
          button('Cancel', cancel),
        ),
        left,
      ];
    }
    case 'match':
      return [
        el('div', { className: 'code', textContent: screen.code }),
        el('p', { textContent: 'It will be able to:' }),
        el(
          'ul',
          {},
          el('li', { textContent: 'Post, send messages and edit as you' }),
          el('li', { textContent: 'Join your spaces' }),
        ),
        el('p', { className: 'note', textContent: 'Only link a device you own or have with you.' }),
        el(
          'div',
          { className: 'row' },
          button('Link', () => step({ kind: 'confirm' }), 'primary'),
          button('Deny', cancel),
        ),
      ];
    case 'revoke-confirm': {
      const p = screen.passphrase ? secretField('Passphrase') : null;
      const go = () => step({ kind: 'revoke', ...(p ? { passphrase: p.input.value } : {}) }, p ? [p.input] : []);
      return [
        ...(p ? [p.label] : []),
        ...errorLine(screen.error),
        el('div', { className: 'row' }, button('Remove', go, 'danger'), button('Cancel', cancel)),
      ];
    }
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
    case 'linked':
    case 'revoked':
    case 'failed':
      return [];
  }
}

function draw(screen: Screen) {
  if (offerTimer !== undefined) {
    window.clearInterval(offerTimer);
    offerTimer = undefined;
  }
  const { title, lead } = heading(screen);
  const parts: Child[] = [el('h1', { textContent: title }), el('p', { textContent: lead }), ...body(screen)];
  if (isLast(screen)) parts.push(el('div', { className: 'row' }, button('Done', finish, 'primary')));
  root.replaceChildren(...parts);
  root.querySelector<HTMLInputElement>('input:not([type=checkbox])')?.focus();
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
