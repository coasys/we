import type { PickerRowOptions, RowAction } from '@we/schema-kit';
import type { SchemaProp } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

/**
 * What a template or a theme in a list *is* — which one is in use, which is the space's default,
 * what choosing it does, and what else can be done to it — apart from how the list draws its rows.
 *
 * The chrome rail's pickers draw these as picker rows and a space's tree draws them as tree rows; the
 * meaning was written once, inline in the pickers, and a second list of the same templates would
 * have been a copy to drift. Each surface passes what closing it means (`after`), which is the only
 * thing that differs: a popover closes behind a choice, a tree stays where it is.
 *
 * Rows are bound as `template` and `theme`, the names every expression here reads.
 */

/** A theme or template's own icon, falling back where a record has none. */
const iconOr = (path: string, fallback: string) => expr`${{ $: path }} ? ${{ $: path }} : ${fallback}`;

/** A row's meaning, as a picker's row takes it — and, with a `value`, a tree's. */
export type Choice = Required<
  Pick<PickerRowOptions, 'icon' | 'label' | 'selected' | 'isDefault' | 'select' | 'actions'>
>;

// ── Templates ───────────────────────────────────────────────────────────────────────────────────

/** Switch to a template, by an expression naming its switcher id. */
export const chooseTemplate = (id: string): SchemaProp => ({
  $invoke: 'templateStore.switchTemplate',
  args: [{ $: id }],
});

/**
 * A template row: the template bound as `template`. `after` follows anything that leaves the list
 * behind — choosing, editing, forking — and not resetting the layout, whose panels moving behind the
 * list are the confirmation.
 */
export function templateChoice(after: SchemaProp[] = []): Choice {
  return {
    icon: { $: 'template.icon' },
    label: { $: 'template.name' },
    selected: { $: 'template.id == templateStore.currentSwitcherId' },
    isDefault: { $: 'template.id == spaceStore.spaceDefaultTemplateId' },
    select: [chooseTemplate('template.id'), ...after],
    actions: [
      /*
        The way back to the arrangement this template designed — its panels where it put them, and
        the ones somebody closed open again.

        On the row for the template you are looking at, and only while there is something to undo,
        which is what `layoutDirty` answers. A control attached to the row it is about, costing
        nothing in the ordinary case because it renders nothing.

        Here rather than in a panel's own position menu, which already carries a per-panel "Reset to
        layout". Three panels dragged out of place is one decision, not three — and a panel somebody
        *closed*, or one that cannot be drawn where it was dropped, has no titlebar left to open a
        menu from, so the per-panel control cannot be the only way back.
      */
      {
        icon: 'arrow-counter-clockwise',
        tooltip: "Reset panels to this template's layout",
        when: { $: 'template.id == templateStore.currentSwitcherId && shellStore.layoutDirty' },
        onClick: { $invoke: 'shellStore.resetTemplateLayout' },
      },
      {
        icon: 'pencil-simple',
        tooltip: 'Edit this template',
        /*
          Any row that can be edited, not just the one already on screen. `editable` rather than
          `editorStore.isReadOnly`, because that answers for whatever is currently rendered and every
          row would have got the same answer; `enterTemplateEditing` has no guard of its own, so
          offering this on a built-in would open a session over something that cannot be saved.
        */
        when: { $: 'template.editable' },
        // Switch first: an editing session is opened over whatever is current.
        onClick: [
          chooseTemplate('template.id'),
          { $invoke: 'editorStore.enterTemplateEditing', args: ['edit'] },
          ...after,
        ],
      },
      {
        icon: 'git-fork',
        tooltip: 'Fork this template',
        // Switch first: a fork is seeded from whatever is current.
        onClick: [chooseTemplate('template.id'), { $invoke: 'editorStore.startFork' }, ...after],
      },
    ] satisfies RowAction[],
  };
}

/**
 * The templates a space's own list offers: the built-in it starts as (its default, or the one on
 * screen), then the space's own, then the agent's — the ones somebody would switch between here,
 * without every built-in the deployment carries. The rail's picker lists all of them.
 */
export const SPACE_TEMPLATE_CHOICES = [
  "distinct(find(templateStore.switcherGroups, { label: 'Built-in' }).items.filter(t, t.id == spaceStore.spaceDefaultTemplateId || t.id == templateStore.currentSwitcherId),",
  "find(templateStore.switcherGroups, { label: 'Space templates' }).items,",
  "find(templateStore.switcherGroups, { label: 'My templates' }).items)",
].join(' ');

// ── Themes ──────────────────────────────────────────────────────────────────────────────────────

/** Wear a theme here, by an expression naming its id — see the note on `themeChoice`'s `select`. */
export const chooseTheme = (id: string): SchemaProp => ({ $invoke: 'spaceStore.applyTheme', args: [{ $: id }] });

/**
 * A theme row: the theme bound as `theme`. Choosing one does not take `after` — see `select`. Forking
 * opens the host's naming dialog (`themeStore.startThemeFork`), so a list needs nothing of its own for it.
 */
export function themeChoice(after: SchemaProp[] = []): Choice {
  return {
    icon: iconOr('theme.icon', 'paint-bucket'),
    label: { $: 'theme.name' },
    selected: { $: 'theme.id == themeStore.currentThemeId' },
    isDefault: { $: 'theme.id == spaceStore.spaceDefaultThemeId' },
    /*
      `applyTheme` rather than `themeStore.setCurrentTheme`: the choice is persisted where it was
      made — pinned to this space, or set as the agent's default when there is no space.

      Deliberately leaves the list open, unlike everything else here. A theme repaints the whole
      window, the list included, so the click is self-evidently landed — and choosing a theme is the
      one thing people do by comparison, trying three in a row.
    */
    select: chooseTheme('theme.id'),
    actions: [
      /*
        The pin — a state, not an offer, which is why it is filled and why it appears on exactly one
        row: the theme this agent pinned *here*, when that pin diverges from what the space would
        otherwise show. Clicking it releases the pin.
      */
      {
        icon: 'push-pin',
        weight: 'fill',
        tooltip: "Pinned to this space — unpin to follow the space's theme",
        when: { $: 'spaceStore.spaceThemePinned && theme.id == themeStore.currentThemeId' },
        onClick: { $invoke: 'spaceStore.clearSpaceThemePin' },
      },
      {
        icon: 'pencil-simple',
        tooltip: 'Edit this theme',
        // A built-in has no stored overrides to edit — forking is the way in.
        when: { $: "theme.origin != 'built-in'" },
        onClick: [
          { $invoke: 'themeStore.setCurrentTheme', args: [{ $: 'theme.id' }] },
          { $invoke: 'themeStore.startEditing', args: [{ $: 'theme.id' }] },
          { $invoke: 'editorStore.enterThemeEditing' },
          ...after,
        ],
      },
      {
        icon: 'git-fork',
        tooltip: 'Fork this theme',
        onClick: [{ $invoke: 'themeStore.startThemeFork', args: [{ $: 'theme.id' }] }, ...after],
      },
    ] satisfies RowAction[],
  };
}

/** The themes a space's own list offers — its own, the agent's, and the built-in it wears or defaults to. */
export const SPACE_THEME_CHOICES = [
  'distinct(themeStore.builtInThemes.filter(t, t.id == spaceStore.spaceDefaultThemeId || t.id == themeStore.currentThemeId),',
  'themeStore.spaceThemes, themeStore.installedThemes)',
].join(' ');
