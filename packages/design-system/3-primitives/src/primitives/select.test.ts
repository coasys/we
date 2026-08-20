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

describe('fit', () => {
  /*
    A select fills its container by default, because option text is usually somebody's data and a
    control that hugs it would be as wide as the longest name in the space. `fit` is for the other
    case — a few short, known words — and measures the *widest option* rather than the current one,
    so choosing never resizes the row.
  */
  it('keeps every option in a hidden sizer, so the width cannot follow the selection', async () => {
    (el as unknown as { fit: boolean }).fit = true;
    el.value = 'a';
    await el.updateComplete;

    const sizer = el.shadowRoot?.querySelector('[part="sizer"]');
    expect(sizer).toBeTruthy();
    expect(sizer?.getAttribute('aria-hidden')).toBe('true');
    // Every label is present regardless of which one is selected.
    expect([...(sizer?.querySelectorAll('span') ?? [])].map((s) => s.textContent)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
      '',
    ]);
  });

  it('carries no sizer when it is not fitting', async () => {
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('[part="sizer"]')).toBeNull();
  });

  it('shows the placeholder as absent text rather than as a value', async () => {
    el.value = '';
    (el as unknown as { placeholder: string }).placeholder = 'Pick one';
    await el.updateComplete;
    const value = el.shadowRoot?.querySelector('[part="value"]');
    expect(value?.textContent?.trim()).toBe('Pick one');
    expect(value?.hasAttribute('data-placeholder')).toBe(true);
  });
});

describe('fitting to its options', () => {
  /*
    The width is set inline rather than by a :host rule in the component's own stylesheet, because
    the design system's generated sheet re-declares width in its interaction rules and wins there.
    The reported symptom was a fitted select sitting at its option width until the pointer arrived
    and then jumping to the full width of its container.
  */
  const fit = async (fitting: boolean) => {
    (el as unknown as { fit: boolean }).fit = fitting;
    await el.updateComplete;
  };

  it('sets its own width inline, where the generated sheet cannot override it', async () => {
    await fit(true);
    expect(el.style.width).toBe('fit-content');
  });

  it('leaves width alone when not fitting', async () => {
    await fit(false);
    expect(el.style.width).toBe('');
  });

  it('defers to an explicit width', async () => {
    // A consumer that asked for a width means it; fit is only the default-sizing opinion.
    await fit(true);
    (el as unknown as { width: string }).width = '200px';
    (el as unknown as { requestUpdate: () => void }).requestUpdate();
    await el.updateComplete;
    expect(el.style.width).toBe('');
  });
});

describe('grouped options', () => {
  /*
    Groups replaced per-option suffixes ("ImageBlock — block"), which were simultaneously redundant
    with the name, inconsistent between groups, and in one case untrue about the options' origin.
    A heading states the group once; the options under it are just their names.
  */
  const GROUPED = [
    { label: 'Recipe', value: 'r', group: 'This space', icon: 'cooking-pot' },
    { label: 'ImageBlock', value: 'i', group: 'Blocks', icon: 'image' },
    { label: 'TaskBlock', value: 't', group: 'Blocks', icon: 'check-square' },
  ];

  beforeEach(async () => {
    el.options = GROUPED;
    await el.updateComplete;
    await press('ArrowDown');
  });

  const headings = () =>
    [...el.shadowRoot!.querySelectorAll('[part="group-heading"]')].map((h) => h.textContent?.trim());

  it('renders one heading per run of options, not one per option', () => {
    expect(headings()).toEqual(['This space', 'Blocks']);
  });

  it('keeps headings out of the keyboard path and the accessibility tree', async () => {
    // Three options, two headings: arrowing from the first lands on the second option, never a heading.
    await press('ArrowDown');
    expect(active()).toBe('ImageBlock');
    for (const h of el.shadowRoot!.querySelectorAll('[part="group-heading"]')) {
      expect(h.getAttribute('role')).toBe('presentation');
      expect(h.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('drops a heading whose options are all filtered out', async () => {
    el.searchable = true;
    await el.updateComplete;
    const input = el.shadowRoot!.querySelector('input') as HTMLInputElement;
    input.value = 'Task';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    expect(headings()).toEqual(['Blocks']);
  });

  it('shows each option its icon, and the trigger the chosen one', async () => {
    const optionIcons = [...el.shadowRoot!.querySelectorAll('[part="option"] we-icon')].map((i) =>
      i.getAttribute('name'),
    );
    expect(optionIcons).toEqual(['cooking-pot', 'image', 'check-square']);
    el.value = 'i';
    await press('Escape');
    expect(el.shadowRoot!.querySelector('[part="value"] we-icon')?.getAttribute('name')).toBe('image');
  });
});
