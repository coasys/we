/**
 * `fetch` for the paired desktop, through the plugin.
 *
 * The WebView refuses the desktop's self-signed certificate, rightly: it has no way to check the
 * pin. ad4m-connect checks `GET <base>/health` before it opens the executor socket, so without this
 * the socket switch alone leaves WE at "Connect AD4M". Requests to any other origin go to the
 * WebView's own `fetch`, unchanged.
 *
 * Text bodies only: what the executor's JSON calls send. A binary body (the transcription audio
 * feed) is refused with a TypeError rather than sent wrong.
 */
import { CoasysTransport } from './plugin';
import type { Pairing } from './websocket';

export function installPinnedFetch(pairing: Pairing): void {
  const native = globalThis.fetch.bind(globalThis);
  const paired = new URL(pairing.url);
  const origin = `${paired.hostname}:${paired.port || '443'}`;

  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null;
    const url = new URL(request ? request.url : String(input), location.href);
    if (url.protocol !== 'https:' || `${url.hostname}:${url.port || '443'}` !== origin) {
      return native(input, init);
    }
    const signal = init?.signal ?? request?.signal;
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? request?.headers).forEach((value, name) => {
      headers[name] = value;
    });
    let body: string | undefined;
    const given = init?.body ?? (request && request.body ? await request.text() : undefined);
    if (given != null) {
      if (typeof given !== 'string') throw new TypeError('The pinned fetch sends text bodies only');
      body = given;
    }

    const answer = CoasysTransport.request({
      url: url.href,
      pin: pairing.pin,
      method: init?.method ?? request?.method ?? 'GET',
      headers,
      body,
    });
    const aborted = new Promise<never>((_, reject) =>
      signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }),
    );
    try {
      const r = await Promise.race([answer, aborted]);
      return new Response(r.status === 204 || r.status === 304 ? null : r.body, {
        status: r.status,
        headers: r.headers,
      });
    } catch (e) {
      if (e instanceof DOMException) throw e;
      // What a failed fetch looks like to a caller; the kind is kept for anyone who looks.
      const error = new TypeError(`Failed to fetch (${(e as { code?: string }).code ?? 'error'})`);
      Object.assign(error, { kind: (e as { code?: string }).code });
      throw error;
    }
  };
}
