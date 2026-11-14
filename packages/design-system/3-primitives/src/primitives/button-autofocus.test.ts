/**
 * A button that takes focus when it is drawn.
 *
 * Settings on a phone swaps its list for the page that was chosen, and the press that did it was on
 * a button that is no longer drawn — focus went with it, back to the top of the document. The Back
 * at the top of the page takes it instead. The `<button>` inside the shadow root is what has to end
 * up focused: focus on the host alone is not a focused control.
 */
import './button';

import { afterEach, describe, expect, it } from 'vitest';

type Mounted = HTMLElement & { updateComplete: Promise<unknown>; autofocus: boolean };

const mount = async (props: Record<string, unknown> = {}): Promise<Mounted> => {
  const el = document.createElement('we-button') as Mounted;
  Object.assign(el, props);
  el.textContent = 'Back';
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
};

const base = (el: Mounted) => el.shadowRoot!.querySelector('[part="base"]');

afterEach(() => document.body.replaceChildren());

describe('a button marked autofocus', () => {
  it('focuses its own control when it is drawn', async () => {
    const el = await mount({ autofocus: true });
    expect(document.activeElement).toBe(el);
    expect(el.shadowRoot!.activeElement).toBe(base(el));
  });

  it('leaves focus where it was otherwise', async () => {
    const other = document.createElement('button');
    document.body.appendChild(other);
    other.focus();
    await mount();
    expect(document.activeElement).toBe(other);
  });
});
