import { field, type PickerRowOptions, type RowAction } from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';
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
 * The state a theme fork needs, declared by whatever holds the rows and {@link themeForkDialog}: the
 * theme being forked, and what its copy starts as.
 */
export const THEME_FORK_LOCALS = {
  forkOpen: { type: 'boolean', initial: false },
  forkSource: { type: 'string', initial: '' },
  forkName: { type: 'string', initial: '' },
  forkIcon: { type: 'string', initial: 'paint-bucket' },
} as const;

/** Open the fork dialog for the theme bound as `theme`, or — with no theme — for a new one. */
export const startThemeFork = (from: 'theme' | 'new'): SchemaProp[] =>
  from === 'theme'
    ? [
        // `from` rather than `value`: only an expression resolves the row being clicked.
        { $setLocal: 'forkSource', value: { $: 'theme.id' } },
        { $setLocal: 'forkName', value: { $: 'theme.name' } },
        { $setLocal: 'forkIcon', value: { $: 'theme.icon' } },
        { $setLocal: 'forkOpen', value: true },
      ]
    : [
        { $setLocal: 'forkSource', value: '' },
        { $setLocal: 'forkName', value: '' },
        { $setLocal: 'forkIcon', value: 'paint-bucket' },
        { $setLocal: 'forkOpen', value: true },
      ];

/**
 * A theme row: the theme bound as `theme`. Choosing one does not take `after` — see `select`.
 * Forking needs {@link THEME_FORK_LOCALS} and {@link themeForkDialog} placed by the list.
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
      { icon: 'git-fork', tooltip: 'Fork this theme', onClick: [...startThemeFork('theme'), ...after] },
    ] satisfies RowAction[],
  };
}

/** The themes a space's own list offers — its own, the agent's, and the built-in it wears or defaults to. */
export const SPACE_THEME_CHOICES = [
  'distinct(themeStore.builtInThemes.filter(t, t.id == spaceStore.spaceDefaultThemeId || t.id == themeStore.currentThemeId),',
  'themeStore.spaceThemes, themeStore.installedThemes)',
].join(' ');

// ── Naming ──────────────────────────────────────────────────────────────────────────────────────

/** "My …" or "This space" — where a new template or theme is saved. */
function destinationToggle(): SchemaNode {
  const option = (value: string, label: string): SchemaNode => ({
    type: 'we-button',
    props: {
      size: 'sm',
      variant: expr`local.destination == ${value} ? 'soft' : 'ghost'`,
      onClick: { $setLocal: 'destination', value },
    },
    children: [label],
  });

  return {
    type: 'Column',
    props: { gap: '100' },
    children: [
      { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: ['Save to'] },
      {
        type: 'Row',
        props: { gap: '200' },
        children: [option('personal', 'Mine'), option('space', 'This space')],
      },
    ],
  };
}

/**
 * The name-and-icon dialog both "New" and "Fork" open, for a template or a theme.
 *
 * `$localState` sits on the modal rather than above it so the fields are seeded *each time it
 * opens* — `initial` is read at mount, and the modal only exists while open. Declared above, they
 * would hold whatever the last fork left behind.
 */
export function nameDialog(opts: {
  open: SchemaProp;
  close: SchemaProp;
  title: SchemaProp;
  initialName: SchemaProp;
  initialIcon: SchemaProp;
  showDestination: SchemaProp;
  confirmLabel: SchemaProp;
  confirm: (args: { name: SchemaProp; icon: SchemaProp; destination: SchemaProp }) => Record<string, unknown>;
}): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: opts.open,
      then: {
        type: 'we-modal',
        props: { size: 'sm', close: opts.close },
        $localState: {
          name: { type: 'string', initial: opts.initialName },
          icon: { type: 'string', initial: opts.initialIcon },
          destination: { type: 'string', initial: 'personal' },
          saving: { type: 'boolean', initial: false },
        },
        children: [
          { type: 'we-text', props: { variant: 'heading-sm' }, children: [opts.title] },
          field({ name: 'name', label: 'Name', placeholder: 'A short, memorable name' }),
          {
            type: 'we-form-field',
            props: { label: 'Icon' },
            children: [
              {
                type: 'we-icon-picker',
                props: {
                  value: { $: 'local.icon' },
                  size: 'sm',
                  onChange: { $setLocal: 'icon', value: { $: 'event.detail' } },
                },
              },
            ],
          },
          { type: '$if', props: { condition: opts.showDestination, then: destinationToggle() } },
          {
            type: 'Row',
            props: { ax: 'end', gap: '200' },
            children: [
              {
                type: 'we-button',
                props: { size: 'sm', variant: 'ghost', disabled: { $: 'local.saving' }, onClick: opts.close },
                children: ['Cancel'],
              },
              {
                type: 'we-button',
                props: {
                  size: 'sm',
                  // Gated on the value itself rather than a `required` rule: nothing about a name is
                  // locally judgeable beyond "is there one".
                  disabled: { $: '!local.name' },
                  loading: { $: 'local.saving' },
                  onClick: [
                    { $setLocal: 'saving', value: true },
                    opts.confirm({
                      name: { $: 'local.name' },
                      icon: { $: 'local.icon' },
                      destination: { $: 'local.destination' },
                    }),
                  ],
                },
                children: [opts.confirmLabel],
              },
            ],
          },
        ],
      },
    },
  };
}

/** Naming a new theme or a fork of one — opened through {@link startThemeFork}, over {@link THEME_FORK_LOCALS}. */
export function themeForkDialog(): SchemaNode {
  return nameDialog({
    open: { $: 'local.forkOpen' },
    close: { $setLocal: 'forkOpen', value: false },
    title: { $: "local.forkSource ? 'Fork theme' : 'New theme'" },
    initialName: { $: 'local.forkName' },
    initialIcon: { $: 'local.forkIcon' },
    showDestination: true,
    confirmLabel: { $: "local.forkSource ? 'Fork' : 'Create'" },
    confirm: ({ name, icon, destination }) => ({
      $invoke: 'themeStore.createAndStartEditing',
      args: [name, icon, { $: 'local.forkSource' }, destination],
      // Resolves `false` when the create failed rather than rejecting, so the close and the mode
      // switch are guarded on the result — otherwise a failed create closes over its own error.
      onSuccess: [
        /*
          In a space, the new theme becomes this agent's choice there, as picking it would make it.
          The fork already wears it, but wearing writes nothing: the space kept the theme chosen
          before, so the screen and the stored choice disagreed.
        */
        {
          $if: {
            condition: { $: 'result && datasetStore.currentDataset' },
            then: { $invoke: 'spaceStore.applyTheme', args: [{ $: 'themeStore.currentThemeId' }] },
          },
        },
        { $if: { condition: { $: 'result' }, then: { $invoke: 'editorStore.enterThemeEditing' } } },
        { $if: { condition: { $: 'result' }, then: { $setLocal: 'forkOpen', value: false } } },
      ],
      onFinally: [{ $setLocal: 'saving', value: false }],
    }),
  });
}
