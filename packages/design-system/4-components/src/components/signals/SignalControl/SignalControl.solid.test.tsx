/**
 * Whose reaction the control reads as the viewer's own.
 *
 * A person on two computers writes from two device keys. A heart given on the laptop has to read as
 * mine on the desktop too, or the desktop draws it unfilled and a press adds a second reaction
 * where the person meant to take theirs back.
 */
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SignalControl } from './SignalControl.solid';
import type { SignalControlProps } from './SignalControl.types';

const DESKTOP = 'did:key:desktop';
const LAPTOP = 'did:key:laptop';
const PERSON = 'did:scid:test:robin';
const like = { icon: 'heart', mode: 'toggle', rangeMin: 0, rangeMax: 1 } as const;

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
});

function press(props: SignalControlProps) {
  host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <SignalControl {...props} />, host);
  host.querySelector('we-button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('my reaction, from any of my computers', () => {
  it('reads a reaction my other computer gave as mine, so pressing takes it back', () => {
    const onSignal = vi.fn();
    press({
      signalType: like,
      signals: [{ signalTypeId: 'like', value: 1, author: LAPTOP }],
      myDids: [DESKTOP, LAPTOP, PERSON],
      onSignal,
    });
    expect(onSignal).toHaveBeenCalledWith(null);
  });

  it("still reads somebody else's reaction as theirs", () => {
    const onSignal = vi.fn();
    press({
      signalType: like,
      signals: [{ signalTypeId: 'like', value: 1, author: 'did:key:ana' }],
      myDids: [DESKTOP, LAPTOP, PERSON],
      onSignal,
    });
    expect(onSignal).toHaveBeenCalledWith(1);
  });
});
