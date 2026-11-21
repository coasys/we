import { drawLinkBrowser, type LinkBrowserOffer } from '@coasys/identity-portal';

import type { PickerDevice } from './record';

/** The words of the frame. Every string goes in through `textContent`; no markup is ever built from data. */
export const TOO_OLD = 'This browser is too old for Coasys';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

/** The one screen of the frame. Each call replaces what the person sees. */
export class Screen {
  private originLine?: HTMLElement;

  constructor(private readonly root: HTMLElement) {}

  private show(title: string, ...parts: HTMLElement[]): void {
    this.root.replaceChildren(...(this.originLine ? [this.originLine] : []), node('h1', title), ...parts);
  }

  message(title: string, text = ''): void {
    this.show(title, ...(text ? [node('p', text)] : []));
  }

  /** The line that names who is asking: the exact origin the browser reported, never a name the app chose. It stays on every screen after this call. */
  askedBy(appName: string, origin: string): void {
    this.originLine = node('p', `${appName} at ${origin} wants to connect to your Coasys.`, 'origin');
  }

  /** The screen of a request that was refused: it names nobody, because nobody was verified. */
  refused(): void {
    this.originLine = undefined;
    this.message('Request refused', 'This page may not ask to connect.');
  }

  link(offer: LinkBrowserOffer, onCancel: () => void): void {
    // The portal draws its own title and lead.
    const body = document.createElement('div');
    drawLinkBrowser(body, offer, onCancel);
    this.root.replaceChildren(...(this.originLine ? [this.originLine] : []), body);
  }

  match(code: string): void {
    this.show(
      'Compare this code',
      node('p', code, 'match'),
      node('p', 'It must be the same on the device that holds your identity.'),
    );
  }

  picker(devices: PickerDevice[], onPick: (device: PickerDevice) => void): void {
    const list = node('div', '', 'devices');
    for (const device of devices) {
      const button = node('button', `${device.name} · ${device.kind}`);
      button.type = 'button';
      button.addEventListener('click', () => onPick(device));
      list.append(button);
    }
    this.show('Choose where your Coasys is', list);
  }
}
