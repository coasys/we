/**
 * What a menu built from data can do.
 *
 * A schema can hand `DropdownMenu` a list of entries computed from rows, and one handler on the menu
 * for all of them — it cannot attach a handler per row. Everything here is a case where that was not
 * enough: a toggle that told nobody it was pressed, a chosen mode nothing could mark, and a list of
 * members too long to read without searching it.
 */
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';

import { DropdownMenu } from './DropdownMenu.solid';
import type { DropdownMenuAction, DropdownMenuToggle } from './DropdownMenu.types';

let dispose: (() => void) | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  dispose?.();
  dispose = undefined;
  host?.remove();
  host = undefined;
});

function mount(ui: () => ReturnType<typeof DropdownMenu>) {
  host = document.createElement('div');
  document.body.append(host);
  dispose = render(ui, host);
  const rows = () => [...host!.querySelectorAll('we-menu-item')] as HTMLElement[];
  return {
    rows,
    labels: () => rows().map((row) => row.textContent?.trim()),
    press: (label: string) => {
      const row = rows().find((r) => r.textContent?.trim() === label);
      row!.dispatchEvent(new CustomEvent('select'));
    },
    search: (text: string) => {
      const field = host!.querySelector('we-input')!;
      field.dispatchEvent(new CustomEvent('input', { detail: text }));
    },
  };
}

describe('a toggle entry built from data', () => {
  it('reports the press to the menu, with the state it had before', () => {
    const seen: (DropdownMenuAction | DropdownMenuToggle)[] = [];
    const menu = mount(() => (
      <DropdownMenu
        triggerLabel="People"
        items={[
          { type: 'toggle', id: 'ana', label: 'Ana', checked: true },
          { type: 'toggle', id: 'ben', label: 'Ben', checked: false },
        ]}
        onSelect={(item) => seen.push(item)}
      />
    ));
    menu.press('Ben');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ id: 'ben', checked: false });
  });

  it('reports a checked state given as an accessor as a plain value', () => {
    const [on] = createSignal(true);
    let reported: unknown;
    const menu = mount(() => (
      <DropdownMenu
        triggerLabel="People"
        items={[{ type: 'toggle', id: 'ana', label: 'Ana', checked: on }]}
        onSelect={(item) => (reported = (item as DropdownMenuToggle).checked)}
      />
    ));
    menu.press('Ana');
    expect(reported).toBe(true);
  });
});

describe('an action entry that is the current choice', () => {
  it('carries the selected state to the row', () => {
    const menu = mount(() => (
      <DropdownMenu
        triggerLabel="Show"
        items={[
          { id: 'dim', label: 'Dim others', selected: true },
          { id: 'hide', label: 'Hide others' },
        ]}
      />
    ));
    const [dim, hide] = menu.rows() as (HTMLElement & { selected?: boolean })[];
    expect(dim.selected).toBe(true);
    expect(hide.selected).toBe(false);
  });
});

describe('a searchable menu', () => {
  const items = [
    {
      type: 'group' as const,
      id: 'show',
      label: 'Show',
      collapsible: false,
      items: [{ id: 'dim', label: 'Dim others' }],
    },
    { type: 'divider' as const },
    { type: 'toggle' as const, id: 'ana', label: 'Ana Ruiz', checked: false },
    { type: 'toggle' as const, id: 'ben', label: 'Ben Okafor', checked: false },
  ];

  it('narrows the entries to the ones whose label matches, ignoring case', () => {
    const menu = mount(() => <DropdownMenu triggerLabel="People" searchable items={items} />);
    expect(menu.labels()).toEqual(['Show', 'Dim others', 'Ana Ruiz', 'Ben Okafor']);
    menu.search('ana');
    expect(menu.labels()).toEqual(['Ana Ruiz']);
  });

  it('takes a group heading away with its entries, and brings everything back when cleared', () => {
    const menu = mount(() => <DropdownMenu triggerLabel="People" searchable items={items} />);
    menu.search('dim');
    expect(menu.labels()).toEqual(['Show', 'Dim others']);
    menu.search('');
    expect(menu.labels()).toHaveLength(4);
    expect(menu.rows().length).toBe(4);
    expect(host!.querySelectorAll('we-divider')).toHaveLength(1);
  });

  it('draws no field on a menu that did not ask for one', () => {
    mount(() => <DropdownMenu triggerLabel="People" items={items} />);
    expect(host!.querySelector('we-input')).toBeNull();
  });
});

describe('a menu about people', () => {
  it('draws a face for an entry that is a person, ringed in its tone', () => {
    mount(() => (
      <DropdownMenu
        triggerLabel="Assign"
        items={[
          { type: 'toggle', id: 'ana', label: 'Ana', checked: true, avatar: { hash: 'did:ana' } },
          { type: 'toggle', id: 'ben', label: 'Ben', checked: false, avatar: { hash: 'did:ben', tone: 'danger' } },
        ]}
      />
    ));
    const faces = [...host!.querySelectorAll('we-menu-item we-avatar')] as (HTMLElement & {
      hash?: string;
      ringColor?: string;
    })[];
    expect(faces.map((f) => f.hash)).toEqual(['did:ana', 'did:ben']);
    expect(faces[0].ringColor).toBeFalsy();
    expect(faces[1].ringColor).toBe('danger');
  });

  it('opens with whatever it is given to press, still inside a button', () => {
    mount(() => (
      <DropdownMenu triggerTitle="Who is on this" items={[{ id: 'a', label: 'A' }]}>
        <span data-testid="faces">AB</span>
      </DropdownMenu>
    ));
    const trigger = host!.querySelector('we-button[slot="trigger"]') as HTMLElement;
    expect(trigger.querySelector('[data-testid="faces"]')).not.toBeNull();
    expect(trigger.getAttribute('aria-label')).toBe('Who is on this');
    // Its own content brings its own hover; the title is a name, not a second tooltip.
    expect(host!.querySelector('we-tooltip[slot="trigger"]')).toBeNull();
  });

  it('opens a group that started closed on the first press', () => {
    const menu = mount(() => (
      <DropdownMenu
        triggerLabel="Assign"
        items={[
          {
            type: 'group',
            id: 'reviewing',
            label: 'Reviewing',
            collapsed: true,
            items: [{ type: 'toggle', id: 'ana', label: 'Ana Ruiz', checked: false }],
          },
        ]}
      />
    ));
    menu.press('Reviewing');
    expect(menu.labels()).toEqual(['Reviewing', 'Ana Ruiz']);
    menu.press('Reviewing');
    expect(menu.labels()).toEqual(['Reviewing']);
  });

  it('opens a closed group while a search is looking inside it', () => {
    const menu = mount(() => (
      <DropdownMenu
        triggerLabel="Assign"
        searchable
        items={[
          {
            type: 'group',
            id: 'reviewing',
            label: 'Reviewing',
            collapsed: true,
            items: [{ type: 'toggle', id: 'ana', label: 'Ana Ruiz', checked: false }],
          },
        ]}
      />
    ));
    expect(menu.labels()).toEqual(['Reviewing']);
    menu.search('ana');
    expect(menu.labels()).toEqual(['Reviewing', 'Ana Ruiz']);
  });

  it('sets a group heading apart from the entries under it', () => {
    const menu = mount(() => (
      <DropdownMenu
        triggerLabel="Assign"
        items={[
          {
            type: 'group',
            id: 'assigned',
            label: 'Assigned',
            items: [{ type: 'toggle', id: 'ana', label: 'Ana Ruiz', checked: false }],
          },
        ]}
      />
    ));
    const text = (label: string) =>
      menu
        .rows()
        .find((row) => row.textContent?.trim() === label)!
        .querySelector('we-text') as HTMLElement & { variant?: string };
    const variant = (el: ReturnType<typeof text>) => el.variant ?? el.getAttribute('variant');
    // The overline variant for "Assigned" — small capitals a theme's overline role reaches — and a
    // name under it stays a name.
    expect(variant(text('Assigned'))).toBe('overline');
    expect(variant(text('Ana Ruiz'))).not.toBe('overline');
  });
});

describe('a group that does not apply here', () => {
  it('is left out, heading and entries, while hidden, and comes back when it is not', () => {
    const [hidden, setHidden] = createSignal(true);
    const menu = mount(() => (
      <DropdownMenu
        triggerLabel="Layers"
        items={[
          {
            type: 'group',
            id: 'background',
            label: 'Background',
            get hidden() {
              return hidden();
            },
            items: [{ type: 'toggle', id: 'stars', label: 'Stars', checked: true }],
          },
          {
            type: 'group',
            id: 'planet',
            label: 'Planet',
            items: [{ type: 'toggle', id: 'borders', label: 'Borders', checked: true }],
          },
        ]}
      />
    ));
    expect(menu.labels()).toEqual(['Planet', 'Borders']);
    setHidden(false);
    expect(menu.labels()).toEqual(['Background', 'Stars', 'Planet', 'Borders']);
  });
});

/**
 * A trigger the caller draws, in its two kinds.
 *
 * Content that is not a control has to be made one, so it goes inside a bare button. Content that
 * already is one went inside that button too, which nested a button in a button and shrank a
 * full-width row to its own content — the rail's "Add a space" row and its account row stood
 * narrower than every row beside them.
 */
describe('a custom trigger', () => {
  const items = [{ id: 'create', label: 'Create a space' }];

  it('is the trigger itself when it is already a control', () => {
    mount(() => (
      <DropdownMenu items={items} triggerTitle="Add a space">
        <we-button width="100%">Add a space</we-button>
      </DropdownMenu>
    ));
    const triggers = [...host!.querySelectorAll('[slot="trigger"]')] as HTMLElement[];

    expect(triggers).toHaveLength(1);
    expect(triggers[0].textContent).toBe('Add a space');
    expect(triggers[0].querySelector('we-button')).toBeNull();
    // Named by the menu's title, through `label` where the element has one (a registered we-button,
    // which jsdom does not load) and `aria-label` otherwise.
    const named = triggers[0] as HTMLElement & { label?: string };
    expect(named.label || named.getAttribute('aria-label')).toBe('Add a space');
  });

  it('is found inside the boxless wrapper a schema node arrives in, which is what is slotted', () => {
    mount(() => (
      <DropdownMenu items={items}>
        <div style={{ display: 'contents' }}>
          <we-button>Add a space</we-button>
        </div>
      </DropdownMenu>
    ));
    const trigger = host!.querySelector('[slot="trigger"]') as HTMLElement;

    expect(trigger.tagName).toBe('DIV');
    expect(trigger.querySelector('we-button')?.textContent).toBe('Add a space');
    expect(host!.querySelectorAll('we-button we-button')).toHaveLength(0);
  });

  it('goes inside a bare button when it is not', () => {
    mount(() => (
      <DropdownMenu items={items} triggerTitle="People">
        <span>Faces</span>
      </DropdownMenu>
    ));
    const trigger = host!.querySelector('[slot="trigger"]') as HTMLElement;

    expect(trigger.tagName).toBe('WE-BUTTON');
    expect(trigger.getAttribute('variant')).toBe('bare');
    expect(trigger.querySelector('span')?.textContent).toBe('Faces');
  });
});
