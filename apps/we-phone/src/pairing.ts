/**
 * The pairing the phone keeps: where the desktop is and which key it must hold.
 *
 * Kept in localStorage for the spike. The pin is not a secret (it names a public key), but the
 * token is a credential, and spike 2 moves it out of JS into the platform keystore.
 */
export interface StoredPairing {
  /** `wss://<desktop>:<port>` as the QR code gives it. */
  url: string;
  /** base64url SHA-256 of the desktop certificate's SubjectPublicKeyInfo. */
  pin: string;
  /** The executor token, when one was entered. Spike only: see above. */
  token?: string;
}

const KEY = 'coasys.pairing';

export function readPairing(): StoredPairing | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as StoredPairing;
    return typeof value.url === 'string' && typeof value.pin === 'string' ? value : null;
  } catch {
    return null;
  }
}

export function writePairing(pairing: StoredPairing): void {
  localStorage.setItem(KEY, JSON.stringify(pairing));
}

export function clearPairing(): void {
  localStorage.removeItem(KEY);
}

/** Reads what a QR code or a paste holds: `{"url":…,"pin":…}`. */
export function parsePairing(text: string): StoredPairing | null {
  try {
    const value = JSON.parse(text.trim()) as Partial<StoredPairing>;
    if (typeof value.url !== 'string' || typeof value.pin !== 'string') return null;
    if (!value.url.startsWith('wss://')) return null;
    return { url: value.url, pin: value.pin, ...(typeof value.token === 'string' ? { token: value.token } : {}) };
  } catch {
    return null;
  }
}
