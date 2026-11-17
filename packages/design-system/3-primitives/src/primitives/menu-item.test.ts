/**
 * Choosing a line, and when that choice is done with the menu around it.
 *
 * A `we-menu-item` fires `select`, and the popover that holds its menu closes on
 * `POPOVER_DISMISS` — but not every line means the same thing for the panel. An action is done once
 * chosen, and a menu still sitting over the row is something the reader has to dismiss first; a
 * toggle is deliberately different, because it is a control somebody may want to flip twice. So the
 * item decides, with `dismiss`, and the default is the one a menu needs most: open.
 */
import './menu-item';

import { POPOVER_DISMISS } from '@we/design-types';
import { describe, expect, it } from 'vitest';

const mount = async (dismiss: boolean) => {
  const item = document.createElement('we-menu-item') as HTMLElement & {
    updateComplete: Promise<unknown>;
    dismiss: boolean;
  };
  if (dismiss) item.setAttribute('dismiss', '');
  const seen: string[] = [];
  const parent = document.createElement('div');
  parent.addEventListener('select', () => seen.push('select'));
  parent.addEventListener(POPOVER_DISMISS, () => seen.push(POPOVER_DISMISS));
  parent.append(item);
  document.body.append(parent);
  await item.updateComplete;
  item.shadowRoot!.querySelector<HTMLElement>("[part='base']")!.click();
  return seen;
};

describe('dismiss', () => {
  it('asks the nearest popover to close once an action line is chosen', async () => {
    expect(await mount(true)).toEqual(['select', POPOVER_DISMISS]);
  });

  it('stays quiet on a plain line, so a toggle leaves the menu open', async () => {
    expect(await mount(false)).toEqual(['select']);
  });
});
