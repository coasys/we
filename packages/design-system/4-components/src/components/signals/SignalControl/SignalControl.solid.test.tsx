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

  it('where two of my computers left a reaction, reads the newest, whichever order they are listed in', () => {
    const vote = { icon: 'arrow-up', mode: 'vote', rangeMin: -1, rangeMax: 1 } as const;
    const older = { signalTypeId: 'vote', value: 1, author: DESKTOP, id: 'r-desk', createdAt: 1000 };
    const newer = { signalTypeId: 'vote', value: -1, author: LAPTOP, id: 'r-lap', createdAt: 2000 };
    for (const signals of [
      [older, newer],
      [newer, older],
    ]) {
      const onSignal = vi.fn();
      // "Vote up" over a newest of -1 changes the vote to +1; over +1 it would take it back.
      press({ signalType: vote, signals, myDids: [DESKTOP, LAPTOP, PERSON], onSignal });
      expect(onSignal).toHaveBeenCalledWith(1);
      dispose?.();
      dispose = undefined;
      host?.remove();
    }
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

describe('the tally beside my reaction', () => {
  const rate = { icon: 'star', mode: 'rating', rangeMin: 1, rangeMax: 5 } as const;

  function show(props: SignalControlProps) {
    host = document.createElement('div');
    document.body.append(host);
    dispose = render(() => <SignalControl {...props} />, host);
    return {
      selected: host.querySelector('[aria-valuenow]')?.getAttribute('aria-valuenow'),
      average: (host.querySelector('.signal-control__agg') as (Element & { value?: number }) | null)?.value,
    };
  }

  it('counts me once, as my newest, when my old rating from another computer could not be removed', () => {
    // 1 from the desktop, then 5 from the laptop — whose removal of the desktop's row was refused.
    const signals = [
      { signalTypeId: 'rate', value: 1, author: DESKTOP, id: 'r-desk', createdAt: 1000 },
      { signalTypeId: 'rate', value: 5, author: LAPTOP, id: 'r-lap', createdAt: 2000 },
      { signalTypeId: 'rate', value: 3, author: 'did:key:ana', id: 'r-ana', createdAt: 1500 },
    ];
    for (const listed of [signals, [...signals].reverse()]) {
      const shown = show({ signalType: rate, signals: listed, myDids: [DESKTOP, LAPTOP, PERSON] });
      expect(shown.selected).toBe('5');
      // (5 + 3) / 2, not (1 + 5 + 3) / 3.
      expect(shown.average).toBe(4);
      dispose?.();
      dispose = undefined;
      host?.remove();
    }
  });

  it("leaves somebody else's two rows as they are", () => {
    const signals = [
      { signalTypeId: 'rate', value: 1, author: 'did:key:ana', id: 'a1', createdAt: 1000 },
      { signalTypeId: 'rate', value: 5, author: 'did:key:ana', id: 'a2', createdAt: 2000 },
    ];
    expect(show({ signalType: rate, signals, myDids: [DESKTOP, LAPTOP, PERSON] }).average).toBe(3);
  });
});
