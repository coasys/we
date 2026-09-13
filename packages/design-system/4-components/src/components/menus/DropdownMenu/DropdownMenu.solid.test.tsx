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
});
