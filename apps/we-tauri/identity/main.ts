/**
 * The identity window (AR-03 4.4.2): its own bundle, its own Tauri capability, and the only page
 * that may run an identity flow. It draws the custody service's screens and sends back what the
 * person typed; the custody service, in the shell's main process, holds every secret and does
 * every signing and network call.
 *
 * Plain DOM with `textContent` only — no template engine, no `innerHTML` — so the window's CSP can
 * forbid every script but its own and every string sink (`require-trusted-types-for 'script'`).
 * Fields are cleared once their call returns.
 */
import './identity.css';

import { invoke } from '@tauri-apps/api/core';

import { heading, isLast, remaining, type Screen, type StepInput, wordNumber } from './screens';

const root = document.getElementById('screen') as HTMLElement;
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

function button(label: string, onClick: () => void, kind: 'primary' | 'danger' | '' = ''): HTMLButtonElement {
  const b = el('button', { className: kind, type: 'button', textContent: label });
  b.addEventListener('click', onClick);
  return b;
}

function secretField(label: string): { label: HTMLLabelElement; input: HTMLInputElement } {
  const input = el('input', { type: 'password', autocomplete: 'off' });
  return { label: el('label', {}, label, input), input };
}

/** Runs a command, draws the screen it answers, and clears the fields it read. */
async function run(command: string, args: Record<string, unknown> = {}, clear: HTMLInputElement[] = []) {
  for (const b of Array.from(root.querySelectorAll('button'))) b.disabled = true;
  try {
    const screen = await invoke<Screen>(command, args);
    draw(screen);
  } catch (error) {
    draw({ screen: 'failed', message: String(error) });
  } finally {
    for (const input of clear) input.value = '';
  }
}

const step = (input: StepInput, clear: HTMLInputElement[] = []) => run('identity_flow_step', { input }, clear);
const cancel = () => void invoke('identity_flow_cancel');
const finish = () => void invoke('identity_flow_finish');

function errorLine(error: string | null): Child[] {
  return error ? [el('p', { className: 'error', textContent: error })] : [];
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
          'I understand: without these words, nobody can recover my identity or change its keys. Not even Coasys.',
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
    case 'offer': {
      const qr = el('img', { className: 'qr' });
      qr.alt = 'QR code of the offer link';
      qr.src = `data:image/svg+xml;utf8,${encodeURIComponent(screen.qrSvg)}`;
      const left = el('p', { className: 'note' });
      const tick = () =>
        (left.textContent = `Works once, for ${remaining(screen.expires, Date.now() / 1000)} · Waiting for your device…`);
      tick();
      offerTimer = window.setInterval(tick, 1000);
      // The claim can come at any moment: ask the custody service to wait for it now, leaving the
      // buttons live so the person can still copy the link or cancel while it waits.
      queueMicrotask(() =>
        invoke<Screen>('identity_flow_step', { input: { kind: 'wait-claim' } satisfies StepInput }).then(
          draw,
          (error) => draw({ screen: 'failed', message: String(error) }),
        ),
      );
      return [
        qr,
        el('div', { className: 'link', textContent: screen.link }),
        el(
          'div',
          { className: 'row' },
          button('Copy the link', () => void navigator.clipboard?.writeText(screen.link)),
          button('Cancel', cancel),
        ),
        left,
      ];
    }
    case 'match':
      return [
        el('div', { className: 'code', textContent: screen.code }),
        el('p', { textContent: 'It will be able to' }),
        el(
          'ul',
          {},
          el('li', { textContent: 'Sign posts, messages and edits as you' }),
          el('li', { textContent: 'Join your identity’s spaces' }),
        ),
        el('p', { className: 'note', textContent: 'Add only a device you run or have in front of you.' }),
        el(
          'div',
          { className: 'row' },
          button('Add it', () => step({ kind: 'confirm' }), 'primary'),
          button('Deny', cancel),
        ),
      ];
    case 'revoke-confirm': {
      const p = screen.passphrase ? secretField('Passphrase') : null;
      const go = () => step({ kind: 'revoke', ...(p ? { passphrase: p.input.value } : {}) }, p ? [p.input] : []);
      return [
        ...(p ? [p.label] : []),
        ...errorLine(screen.error),
        el('div', { className: 'row' }, button('Revoke', go, 'danger'), button('Cancel', cancel)),
      ];
    }
    case 'identity-ready':
      return [
        el('div', { className: 'link', textContent: screen.did }),
        el('p', { className: 'note', textContent: `This computer is ${screen.keyId} in your key log.` }),
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

void run('identity_flow_start');
