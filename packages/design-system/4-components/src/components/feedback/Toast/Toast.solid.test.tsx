/**
 * Where the toast box sits. The app mounts it bottom-right — the demo's error
 * toasts used to stack over the view tabs at top right, on top of the thing a
 * person was reaching for. The container honours the position it is given; the
 * class is what the CSS hangs `bottom`/`right` off.
 */
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { ToastContainer } from './Toast.solid';

let dispose: (() => void) | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  document.body.innerHTML = '';
});

describe('ToastContainer', () => {
  it('draws bottom-right when the host asks for bottom-right', () => {
    dispose = render(() => <ToastContainer position="bottom-right" />, document.body);
    const container = document.body.querySelector('.we-toast-container');
    expect(container?.className).toContain('we-toast-container--bottom-right');
  });
});
