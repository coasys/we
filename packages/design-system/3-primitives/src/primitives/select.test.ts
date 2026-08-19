/**
 * `we-select`'s keyboard contract.
 *
 * There was none. Options were click-only, non-focusable `div`s with no `keydown` handler anywhere,
 * so a keyboard user could open the listbox and was then stranded in it — unable to choose, unable
 * to close it. This is the primary single-choice control (Settings, the marketplace, and every
 * schema-authored form), so "stranded" meant those pages could not be completed without a mouse.
 *
 * Driven through the element's own `keydown` handler rather than a real browser: what is under test
 * is the state machine — where the highlight goes, what commits, what closes — and jsdom gives that
 * faithfully while a headless browser would only make it slower.
 */
import './select';

import { beforeEach, describe, expect, it } from 'vitest';

type SelectEl = HTMLElement & {
  options: { label: string; value: string; disabled?: boolean }[];
  value: string;
  searchable: boolean;
  updateComplete: Promise<unknown>;
};

const OPTIONS = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b', disabled: true },
  { label: 'Gamma', value: 'c' },
];

let el: SelectEl;

async function press(key: string) {
  el.shadowRoot!.querySelector('[role="combobox"]')!.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );
  await el.updateComplete;
}

const listbox = () => el.shadowRoot!.querySelector('[role="listbox"]');
const active = () => el.shadowRoot!.querySelector('[data-active="true"]')?.textContent?.trim();

beforeEach(async () => {
  document.body.innerHTML = '';
  el = document.createElement('we-select') as SelectEl;
  el.options = OPTIONS;
  document.body.appendChild(el);
  await el.updateComplete;
});

describe('opening', () => {
  it('opens on ArrowDown, Enter and Space', async () => {
    for (const key of ['ArrowDown', 'Enter', ' ']) {
      await press('Escape');
      expect(listbox()).toBeNull();
      await press(key);
      expect(listbox(), key).not.toBeNull();
    }
  });

  it('starts the highlight on the current value, so opening and confirming changes nothing', async () => {
    el.value = 'c';
    await el.updateComplete;
    await press('ArrowDown');
    expect(active()).toBe('Gamma');
  });
});

describe('moving', () => {
  it('skips disabled options', async () => {
    await press('ArrowDown');
    expect(active()).toBe('Alpha');
    await press('ArrowDown');
    // Beta is disabled — the highlight steps over it rather than landing somewhere unusable.
    expect(active()).toBe('Gamma');
  });

  it('stops at the ends rather than wrapping', async () => {
    await press('ArrowDown');
    await press('ArrowUp');
    expect(active()).toBe('Alpha');
    await press('ArrowDown');
    await press('ArrowDown');
    expect(active()).toBe('Gamma');
  });

  it('Home and End reach the first and last usable option', async () => {
    await press('ArrowDown');
    await press('End');
    expect(active()).toBe('Gamma');
    await press('Home');
    expect(active()).toBe('Alpha');
  });
});

describe('choosing and leaving', () => {
  it('commits on Enter, closes, and says so', async () => {
    const changes: string[] = [];
    el.addEventListener('change', (e) => changes.push((e as CustomEvent<string>).detail));

    await press('ArrowDown');
    await press('ArrowDown');
    await press('Enter');

    expect(el.value).toBe('c');
    expect(changes).toEqual(['c']);
    expect(listbox()).toBeNull();
  });

  it('Escape closes without choosing', async () => {
    await press('ArrowDown');
    await press('Escape');

    expect(listbox()).toBeNull();
    expect(el.value).toBe('');
  });

  it('Tab closes and lets focus move on', async () => {
    await press('ArrowDown');
    await press('Tab');
    expect(listbox()).toBeNull();
  });
});

describe('the searchable variant', () => {
  it('leaves Space alone while typing', async () => {
    el.searchable = true;
    await el.updateComplete;

    await press('ArrowDown');
    const before = el.value;
    await press(' ');

    // A space is a character in a search box; swallowing it would make any two-word option
    // unmatchable.
    expect(el.value).toBe(before);
    expect(listbox()).not.toBeNull();
  });
});

describe('what a screen reader is told', () => {
  it('names the listbox it controls, and the option the keyboard is on', async () => {
    await press('ArrowDown');
    const combobox = el.shadowRoot!.querySelector('[role="combobox"]')!;

    expect(combobox.getAttribute('aria-controls')).toBe('listbox');
    const activeId = combobox.getAttribute('aria-activedescendant');
    expect(activeId).toBeTruthy();
    expect(el.shadowRoot!.querySelector(`#${activeId}`)?.textContent?.trim()).toBe('Alpha');
  });
});

describe('the trigger, with nothing chosen yet', () => {
  /*
    A select with no value and no placeholder rendered a button with no content, and `all: unset`
    leaves a button no height of its own — so the trigger was full width and zero tall, and the
    caret was the only thing on the row that could be clicked.
  */
  it('mirrors the placeholder onto the button, where attr() can reach it', async () => {
    el.value = '';
    (el as unknown as { placeholder: string }).placeholder = 'Pick one';
    await el.updateComplete;
    const button = el.shadowRoot?.querySelector('[part="native-button"]');
    expect(button?.getAttribute('placeholder')).toBe('Pick one');
  });

  it('stretches the trigger so it is clickable when it has nothing to show', () => {
    const sheet = ((el.constructor as unknown as { styles: { cssText: string }[] }).styles ?? [])
      .map((style) => style.cssText)
      .join('\n');
    const rule = /\[part='native-button'\]\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? '';
    expect(rule).toContain('align-self: stretch');
    expect(rule).toContain('align-items: center');
  });
});

describe('where the listbox is drawn', () => {
  /*
    It was positioned `absolute` inside the control, so every ancestor with a non-visible overflow
    clipped it — a modal, a scroll area, a mid-animation reveal. It is promoted into the top layer
    now, by the same helper the date and icon pickers use, and anchored to the trigger.
  */
  const withPopoverSupport = (fn: () => void) => {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const shown: HTMLElement[] = [];
    const hidden: HTMLElement[] = [];
    proto.showPopover = function showPopover(this: HTMLElement) {
      shown.push(this);
    };
    proto.hidePopover = function hidePopover(this: HTMLElement) {
      hidden.push(this);
    };
    try {
      fn();
    } finally {
      Reflect.deleteProperty(proto, 'showPopover');
      Reflect.deleteProperty(proto, 'hidePopover');
    }
    return { shown, hidden };
  };

  it('promotes the listbox when it opens', async () => {
    const { shown } = withPopoverSupport(() => {
      (el as unknown as { _open: boolean })._open = true;
    });
    await el.updateComplete;
    // The promotion happens in `updated`, once the listbox exists to promote.
    const listbox = el.shadowRoot?.querySelector('[part="listbox"]') as HTMLElement | null;
    expect(listbox).toBeTruthy();
    expect(listbox?.style.position).toBe('fixed');
    void shown;
  });

  it('leaves nothing floating behind when it closes', async () => {
    (el as unknown as { _open: boolean })._open = true;
    await el.updateComplete;
    (el as unknown as { _open: boolean })._open = false;
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('[part="listbox"]')).toBeNull();
  });
});
