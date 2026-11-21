/**
 * The two screens the Connect frame and the desktop and phone windows share beyond the custody
 * flows: the person's devices, and "Link this browser". Each is a pure model (the wording, tested
 * without a page) and a small drawer into a node the caller owns. `textContent` only, as in
 * `window.ts`, so the same strict policy holds.
 */

/** The device kinds a record names (`ad4m_identity_core::record::DeviceKind`, kebab-case). */
export type DeviceKind = 'desktop-app' | 'phone-app' | 'browser' | 'server' | 'community-host' | 'coasys-cloud' | 'bot';

/** One device as the key log and the record list it. */
export interface DeviceInfo {
  keyId: string;
  name: string;
  kind: DeviceKind;
  /** Unix seconds of the device's last sign-in; absent when it has not been used. */
  lastUsed?: number | null;
}

/** One line of the device list, as drawn. */
export interface DeviceRow {
  keyId: string;
  title: string;
  kind: string;
  lastUse: string;
  /** A browser's key is the only one revoked from this list: the others have their own flows. */
  revokeLabel: string | null;
}

const KIND_WORDS: Record<DeviceKind, string> = {
  'desktop-app': 'Computer',
  'phone-app': 'Phone',
  browser: 'Browser',
  server: 'Server',
  'community-host': 'Community host',
  'coasys-cloud': 'Cloud',
  bot: 'Bot',
};

export const REVOKE_DEVICE_KEY = 'Revoke device key';

/** "Last used 3 hours ago", "Last used 12 Mar 2026", or "Never used". */
export function lastUseLine(lastUsed: number | null | undefined, nowSeconds: number): string {
  if (lastUsed == null) return 'Never used';
  const ago = Math.max(0, nowSeconds - lastUsed);
  if (ago < 60) return 'Last used just now';
  const unit = (n: number, word: string) => `Last used ${n} ${word}${n === 1 ? '' : 's'} ago`;
  if (ago < 3600) return unit(Math.floor(ago / 60), 'minute');
  if (ago < 86400) return unit(Math.floor(ago / 3600), 'hour');
  if (ago < 30 * 86400) return unit(Math.floor(ago / 86400), 'day');
  const date = new Date(lastUsed * 1000);
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    date.getUTCMonth()
  ];
  return `Last used ${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`;
}

/** The list's rows: browsers first, since they come and go, then the rest in the order given. */
export function deviceRows(devices: DeviceInfo[], nowSeconds: number): DeviceRow[] {
  const rows = devices.map((d) => ({
    keyId: d.keyId,
    title: d.name,
    kind: KIND_WORDS[d.kind],
    lastUse: lastUseLine(d.lastUsed, nowSeconds),
    revokeLabel: d.kind === 'browser' ? REVOKE_DEVICE_KEY : null,
  }));
  return [...rows.filter((r) => r.revokeLabel), ...rows.filter((r) => !r.revokeLabel)];
}

export interface LinkBrowserOffer {
  /**
   * The browser's device link: `https://<auth domain>/link#coasys:device:1:…`. A desktop or phone
   * that opens it reads the string after `#` and lists the device as a browser.
   */
  link: string;
  /** The same link as a QR code, SVG text. */
  qrSvg: string;
}

export const LINK_BROWSER_TITLE = 'Link this browser';
export const LINK_BROWSER_LEAD =
  'Open this link, or scan the code, in an app that holds your identity. It shows a code to compare with the one here.';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

/** Draws the device list into `parent`; `onRevoke(keyId)` runs when "Revoke device key" is pressed. */
export function drawDevices(
  parent: HTMLElement,
  devices: DeviceInfo[],
  onRevoke: (keyId: string) => void,
  nowSeconds = Date.now() / 1000,
): void {
  parent.replaceChildren();
  for (const row of deviceRows(devices, nowSeconds)) {
    const item = node('div', 'device');
    item.append(node('strong', '', row.title), node('span', 'note', ` · ${row.kind} · ${row.lastUse}`));
    if (row.revokeLabel) {
      const button = node('button', 'danger', row.revokeLabel);
      button.type = 'button';
      button.addEventListener('click', () => onRevoke(row.keyId));
      item.append(button);
    }
    parent.append(item);
  }
}

/** Draws "Link this browser": the QR code, the link with a copy button, and a cancel. */
export function drawLinkBrowser(parent: HTMLElement, offer: LinkBrowserOffer, onCancel: () => void): void {
  const qr = node('img', 'qr');
  qr.alt = 'QR code of this browser’s device link';
  qr.src = `data:image/svg+xml;utf8,${encodeURIComponent(offer.qrSvg)}`;
  const copy = node('button', '', 'Copy link');
  copy.type = 'button';
  copy.addEventListener('click', () => void navigator.clipboard?.writeText(offer.link));
  const cancel = node('button', '', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', onCancel);
  const row = node('div', 'row');
  row.append(copy, cancel);
  parent.replaceChildren(
    node('h1', '', LINK_BROWSER_TITLE),
    node('p', 'lead', LINK_BROWSER_LEAD),
    qr,
    node('div', 'link', offer.link),
    row,
  );
}
