/*
  Not `.schema.ts`, and that is the point.

  Everything here is a *builder* with an ambient contract: `templatePicker()` reads
  `local.templatePickerOpen`, which the rail that composes it declares. `.schema.ts` means "this
  file exports a schema the validator can judge on its own", and one of these judged alone reports
  ten errors about state it was never meant to own — which is why they were functions in the first
  place (see the note on `templatePicker`).

  So the file said "no schema export found" on every validation run: a warning that was accurate
  about a file that is correctly outside the walk, and which had to be read and dismissed each time.
  The composed rail *is* validated, and that is where these are covered.
*/
/**
 * Choosing a template and choosing a theme — the two pickers that live in the chrome rail.
 *
 * ## Why these are data
 *
 * They were 1200 lines of TSX in `@we/editor`, pinned to the top-right corner of the window in a
 * band no layout calculation reserved — so every template drew its own header into space the app
 * believed was free, and the chips were covered or in the way depending on the page. Moving them
 * into the rail fixes the collision; expressing them as schema is what makes them forkable when
 * chrome becomes a marketplace category, and what let the two of them stop drifting apart.
 *
 * Everything they touch is already granted: `appearance` covers reading the lists and switching,
 * `editor` covers entering an editing session, and `library` covers publishing. See
 * `app-shell/src/shared/registries/templateSurface.ts`.
 *
 * ## Both halves in one file
 *
 * They are the same surface twice over, and they have been rewritten in parallel twice already.
 * Side by side, a change to one is visibly a change the other did or did not get.
 *
 * ## What stayed in code
 *
 * The editing bar — undo/redo, preview/visual, share, exit. Those act on a live editing session
 * rather than on a choice, they must stay on screen continuously while editing, and they are what
 * `mountTemplateEditor` gives an embedding application through `EditorHost`. See `EditingBar.tsx`.
 */
import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { expr } from '@we/schema-shared';
import { field, pickerPopover, pickerRow, templateChoice, themeChoice } from '@we/template-kit';

/** Rows whose name contains what is typed in the picker's search box. */
const matching = (items: SchemaProp) => expr`filter(${items}, { name: { contains: local.pickerSearch } })`;

/**
 * The flags that hold each picker open, declared together on the rail by `chromeRail`.
 *
 * Above both pickers rather than inside either, because only something holding the pair can close
 * one when the other opens — and two independently-owned flags meant clicking the second left the
 * first up and the two surfaces overlapped.
 */
export const TEMPLATE_PICKER_OPEN = 'templatePickerOpen';
export const THEME_PICKER_OPEN = 'themePickerOpen';

/**
 * Dismiss a picker — appended to anything that leaves it behind: switching template, opening the
 * editor, raising a dialog. A picker left up over a change it cannot show reads as a click that
 * missed.
 *
 * Choosing a *theme* is the exception and does not close: see the note on that row's `select`.
 */
const closeTemplatePicker = { $setLocal: TEMPLATE_PICKER_OPEN, value: false };
const closeThemePicker = { $setLocal: THEME_PICKER_OPEN, value: false };

/** A theme or template's own icon, falling back where a record has none. */
const iconOr = (path: string, fallback: string) => expr`${{ $: path }} ? ${{ $: path }} : ${fallback}`;

/**
 * A labelled group of rows, absent entirely when the search has emptied it.
 *
 * The filter is written once and emitted twice — once to count, once to iterate — because a group
 * heading over nothing is worse than no group at all, and the two must agree about what "nothing"
 * means.
 */
function section(label: SchemaProp, rows: SchemaProp, body: SchemaNode): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: expr`count(${rows})`,
      then: {
        type: 'Column',
        props: { gap: '100' },
        children: [
          {
            type: 'we-text',
            props: { variant: 'footnote', color: 'text-faint', px: '200', pt: '200' },
            children: [label],
          },
          body,
        ],
      },
    },
  };
}

// ── Naming ──────────────────────────────────────────────────────────────────────────────────────

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
function nameDialog(opts: {
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

// ── Templates ───────────────────────────────────────────────────────────────────────────────────

/**
 * Whether the layouts section is offered yet. Flip to `true` to ship it.
 *
 * Layouts, "Remember this arrangement…" and "Fork as a new template" are all built and none has
 * been exercised. Three unproven entries at the top of the one menu people use to change template
 * is a busy picker charging every reader for a feature nobody has tried.
 *
 * A flag at the composition level rather than a condition inside the section, because the two
 * answer different questions. A condition asks "should this show *now*", and every honest answer
 * to that is something a reader can reach: gating on `sessionStore.devTools` was the first
 * attempt, and it is on in a development build, so it hid the section from everyone except the
 * person who wanted it hidden. This asks "is it finished", which nothing at runtime should be able
 * to change.
 *
 * Not deleted, because the blocker is testing and a deleted section cannot be tested. It stays
 * referenced below, so TypeScript keeps it compiling and a rename cannot leave it behind — the
 * trade being that the schema audits walk the composed tree and so no longer see it. Nothing it
 * paints is on screen to be wrong, and flipping this puts it back under all of them.
 */
const LAYOUTS_READY = false;

const templateRows = matching({ $: 'group.items' });

/**
 * The apps — the chrome around every space — above the templates, and apart from them.
 *
 * Not a sixth group in the same list, because a row here means something else: a template row
 * changes what is on screen in this space, and an app row changes the chrome in every space. And the
 * groups below split by who owns a template, a split apps barely have — they are WE's, or the
 * agent's own copies — so one section, the copies after WE's.
 *
 * The same three things a template row does, aimed at the app: choose it, edit it where it is drawn,
 * or fork it. WE's own app is built in, so it is forked rather than edited, as a built-in template is.
 */
const appRows = expr`filter(templateStore.appTemplateOptions, { label: { contains: local.pickerSearch } })`;

function appsSection(): SchemaNode {
  return section('App — around every space', appRows, {
    type: '$each',
    props: { items: appRows, as: 'app' },
    children: [
      pickerRow({
        icon: iconOr('app.icon', 'app-window'),
        label: { $: 'app.label' },
        selected: { $: 'app.value == templateStore.appTemplateId' },
        select: [{ $invoke: 'templateStore.setAppTemplate', args: [{ $: 'app.value' }] }, closeTemplatePicker],
        actions: [
          {
            icon: 'pencil-simple',
            tooltip: 'Edit this app',
            when: { $: 'app.editable' },
            onClick: [{ $invoke: 'editorStore.editApp', args: [{ $: 'app.value' }] }, closeTemplatePicker],
          },
          {
            icon: 'git-fork',
            tooltip: 'Fork this app',
            onClick: [{ $invoke: 'editorStore.forkApp', args: [{ $: 'app.value' }] }, closeTemplatePicker],
          },
        ],
      }),
    ],
  });
}

/**
 * The arrangements saved for the template on screen, and the way to save another.
 *
 * At the top of the template picker rather than in a panel's own menu, for the reason "Reset
 * layout" is on the template's row: an arrangement is a fact about the whole interface, and a panel
 * somebody closed has no titlebar to reach a menu from. Absent entirely until there is a layout to
 * show or something worth saving — an interface with no panels never sees it.
 *
 * Not currently placed — see {@link LAYOUTS_READY}.
 */
function layoutsSection(): SchemaNode {
  const rows = { $: 'shellStore.layoutNames' };
  return {
    type: '$if',
    props: {
      condition: { $: 'count(shellStore.layoutNames) || shellStore.layoutDirty' },
      then: {
        type: 'Column',
        props: { gap: '100' },
        children: [
          {
            type: 'we-text',
            props: { variant: 'footnote', color: 'text-faint', px: '200', pt: '200' },
            children: ['Layouts'],
          },
          {
            type: '$each',
            props: { items: rows, as: 'layout' },
            children: [
              pickerRow({
                icon: 'bookmark-simple',
                label: { $: 'layout' },
                selected: { $: 'layout == shellStore.activeLayout' },
                select: { $invoke: 'shellStore.applyLayout', args: [{ $: 'layout' }] },
                actions: [
                  {
                    icon: 'trash',
                    tooltip: 'Forget this layout',
                    onClick: { $invoke: 'shellStore.deleteLayout', args: [{ $: 'layout' }] },
                  },
                ],
              }),
            ],
          },
          {
            type: 'we-button',
            props: {
              variant: 'ghost',
              size: 'sm',
              width: '100%',
              ax: 'start',
              gap: '200',
              onClick: { $setLocal: 'saveLayoutOpen', value: true },
            },
            children: [
              { type: 'we-icon', props: { name: 'bookmark-simple' } },
              { type: 'we-text', children: ['Remember this arrangement…'] },
            ],
          },
          /*
            The bridge from arranging to authoring — explicit, named, and here beside the other
            things one can do with an arrangement. Only while there is an arrangement to save: an
            untouched template forked this way would be the template again.

            Divided from the layouts above it, and worded away from them. The two were both "Save
            …" and adjacent, which said they were a pair — and they are opposites: a layout is a
            private bookmark on this device that you switch between, and this makes a template other
            people can be given. Read cold, nobody could tell which was which.
          */
          { type: 'we-divider', props: { my: '100' } },
          {
            type: '$if',
            props: {
              condition: { $: 'shellStore.layoutDirty' },
              then: {
                type: 'we-button',
                props: {
                  variant: 'ghost',
                  size: 'sm',
                  width: '100%',
                  ax: 'start',
                  gap: '200',
                  onClick: [{ $invoke: 'shellStore.saveArrangementAsTemplate' }, closeTemplatePicker],
                },
                children: [
                  { type: 'we-icon', props: { name: 'git-fork' } },
                  { type: 'we-text', children: ['Fork as a new template'] },
                ],
              },
            },
          },
        ],
      },
    },
  };
}

/** Name the arrangement on screen. Mounted only while open, so the field starts empty each time. */
function saveLayoutDialog(): SchemaNode {
  const close = { $setLocal: 'saveLayoutOpen', value: false };
  return {
    type: '$if',
    props: {
      condition: { $: 'local.saveLayoutOpen' },
      then: {
        type: 'we-modal',
        props: { size: 'sm', close },
        $localState: { layoutName: { type: 'string', initial: '' } },
        children: [
          { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Save layout'] },
          field({ name: 'layoutName', label: 'Name', placeholder: 'Recording, reviewing, …' }),
          {
            type: 'Row',
            props: { ax: 'end', gap: '200' },
            children: [
              { type: 'we-button', props: { size: 'sm', variant: 'ghost', onClick: close }, children: ['Cancel'] },
              {
                type: 'we-button',
                props: {
                  size: 'sm',
                  disabled: { $: '!local.layoutName' },
                  onClick: [{ $invoke: 'shellStore.saveLayout', args: [{ $: 'local.layoutName' }] }, close],
                },
                children: ['Save'],
              },
            ],
          },
        ],
      },
    },
  };
}

/**
 * The template picker.
 *
 * **Ambient contract:** must be placed inside a node declaring {@link TEMPLATE_PICKER_OPEN} and
 * {@link THEME_PICKER_OPEN} — `chromeRail` does. A function rather than a node for that reason: an
 * exported node is validated on its own, where a reference to an ancestor's state has nothing to
 * resolve against, and the composed rail is the only place the question is answerable.
 *
 * "New" and "Fork" go through `editorStore`'s own picker state rather than local flags, because
 * that store already knows what a fork is seeded from and whether the destination question applies.
 * The theme side has no such state and carries its own — the asymmetry is in the stores, not here.
 */
export function templatePicker(): SchemaNode {
  return {
    type: 'Column',
    // The save-layout dialog's flag lives on the picker, which is the only thing that opens it.
    $localState: { saveLayoutOpen: { type: 'boolean', initial: false } },
    children: [
      pickerPopover({
        openLocal: TEMPLATE_PICKER_OPEN,
        closeOthers: [THEME_PICKER_OPEN],
        icon: 'layout',
        tooltip: 'Template',
        searchPlaceholder: 'Search templates…',
        body: {
          type: 'Column',
          children: [
            ...(LAYOUTS_READY ? [layoutsSection()] : []),
            appsSection(),
            {
              type: '$each',
              props: { items: { $: 'templateStore.switcherGroups' }, as: 'group' },
              children: [
                section({ $: 'group.label' }, templateRows, {
                  type: '$each',
                  props: { items: templateRows, as: 'template' },
                  children: [pickerRow(templateChoice([closeTemplatePicker]))],
                }),
              ],
            },
          ],
        },
        footer: {
          type: 'we-button',
          props: {
            variant: 'ghost',
            width: '100%',
            ax: 'start',
            gap: '200',
            onClick: [{ $invoke: 'editorStore.startFresh' }, closeTemplatePicker],
          },
          children: [
            { type: 'we-icon', props: { name: 'plus' } },
            { type: 'we-text', children: ['New template'] },
          ],
        },
      }),

      saveLayoutDialog(),
    ],
  };
}

/**
 * Naming a fork or a new template: the dialog `editorStore.startFork` and `startFresh` open.
 *
 * The host's, drawn as an overlay of its own (`core:templateNameDialog`) rather than inside the
 * template picker that opens it most often. The picker is in the module rail, which is a piece of the
 * app — and so it is inert while the app is edited visually, absent from an app that leaves the rail
 * out, and not the only thing that opens this: the inspector forks the app from its own bar. A dialog
 * the editor depends on cannot live inside what the editor is editing.
 */
export const templateNameDialog: SchemaNode = nameDialog({
  open: { $: 'editorStore.pickerOpen' },
  close: { $invoke: 'editorStore.cancelPicker' },
  title: { $: "editorStore.pickerAction == 'fresh' ? 'New template' : 'Fork template'" },
  initialName: { $: 'editorStore.pickerDefaultName' },
  initialIcon: { $: 'editorStore.pickerDefaultIcon' },
  showDestination: { $: 'editorStore.pickerShowDestination' },
  confirmLabel: { $: "editorStore.pickerAction == 'fresh' ? 'Create' : 'Fork'" },
  confirm: ({ name, icon, destination }) => ({
    $invoke: 'editorStore.confirmPicker',
    args: [name, icon, destination],
    onFinally: [{ $setLocal: 'saving', value: false }],
  }),
});

// ── Themes ──────────────────────────────────────────────────────────────────────────────────────

/** A theme section, over one of the three store arrays the themes are grouped into. */
function themeSection(label: string, storePath: string): SchemaNode {
  const rows = matching({ $: storePath });

  return section(label, rows, {
    type: '$each',
    props: { items: rows, as: 'theme' },
    children: [pickerRow(themeChoice([closeThemePicker]))],
  });
}

/**
 * The theme picker.
 *
 * **Ambient contract:** same as {@link templatePicker} — needs both open flags from an ancestor.
 *
 * The scope control sits in the footer with words on it. It used to be a `globe`/`globe-x` button
 * in the chip strip, which was undecodable, and it wrote a *preview* that lasted the editing
 * session — so the setting it masked drifted from what was on screen. This is the setting itself.
 */
export function themePicker(): SchemaNode {
  return {
    type: 'Column',
    children: [
      pickerPopover({
        openLocal: THEME_PICKER_OPEN,
        closeOthers: [TEMPLATE_PICKER_OPEN],
        icon: 'palette',
        tooltip: 'Theme',
        searchPlaceholder: 'Search themes…',
        body: {
          type: 'Column',
          props: { gap: '100' },
          children: [
            themeSection('Space themes', 'themeStore.spaceThemes'),
            themeSection('My themes', 'themeStore.installedThemes'),
            themeSection('Built-in', 'themeStore.builtInThemes'),
            /*
              Last, and under its own heading, because it is not a theme.

              It carries no parameters — it is a question, answered at the point of use by asking the
              operating system, and it resolves to one of the built-ins above. Listed among them it
              was the first row a fresh agent saw, above every actual theme, labelled as a built-in
              one; the first thing anyone asked about it was what it was.

              Still in the picker rather than moved to settings, because it is *mutually exclusive*
              with choosing a theme: whatever sets it has to be somewhere the picker can show as
              selected, or two surfaces end up disagreeing about what is on screen.
            */
            themeSection('Automatic', 'themeStore.automaticThemes'),
            /*
              And which two it chooses between, beside it rather than in settings — the row above is
              meaningless without them. Left out, "Follow system" means "match my machine using the
              two built-ins", so an agent who made their own pair could follow their machine or wear
              their own themes and never both.
            */
            {
              type: 'Row',
              props: { gap: '200', ay: 'center', px: '200' },
              children: [
                {
                  type: 'we-form-field',
                  props: { label: 'Light', size: 'sm', flex: '1' },
                  children: [
                    {
                      type: 'we-select',
                      props: {
                        size: 'sm',
                        options: { $: 'themeStore.systemThemeOptions' },
                        value: { $: 'themeStore.systemThemes.light' },
                        onChange: { $invoke: 'themeStore.setSystemTheme', args: ['light', { $: 'arg.detail' }] },
                      },
                    },
                  ],
                },
                {
                  type: 'we-form-field',
                  props: { label: 'Dark', size: 'sm', flex: '1' },
                  children: [
                    {
                      type: 'we-select',
                      props: {
                        size: 'sm',
                        options: { $: 'themeStore.systemThemeOptions' },
                        value: { $: 'themeStore.systemThemes.dark' },
                        onChange: { $invoke: 'themeStore.setSystemTheme', args: ['dark', { $: 'arg.detail' }] },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
        footer: {
          type: 'Column',
          props: { gap: '200' },
          children: [
            {
              type: 'we-button',
              props: {
                variant: 'ghost',
                width: '100%',
                ax: 'start',
                gap: '200',
                onClick: [{ $invoke: 'themeStore.startThemeFork' }, closeThemePicker],
              },
              children: [
                { type: 'we-icon', props: { name: 'plus' } },
                { type: 'we-text', children: ['New theme'] },
              ],
            },
            { type: 'we-divider' },
            {
              type: 'Row',
              props: { ay: 'center', ax: 'between', gap: '300', px: '200', pb: '100' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '0', flex: '1' },
                  children: [
                    { type: 'we-text', props: { variant: 'label' }, children: ['Apply across the whole app'] },
                    {
                      type: 'we-text',
                      props: { variant: 'footnote', color: 'text-muted' },
                      children: ["Off, it themes only this space's content"],
                    },
                  ],
                },
                {
                  type: 'we-switch',
                  props: {
                    checked: { $: 'themeStore.themeScopeGlobal' },
                    // Passed bare: the switch emits the boolean, and wrapping it in an operator would
                    // resolve at render time and send a constant.
                    onChange: { $invoke: 'themeStore.setThemeScopeGlobal', args: [{ $: 'event.detail' }] },
                  },
                },
              ],
            },
          ],
        },
      }),
    ],
  };
}

/**
 * Naming a new theme or a fork of one: the dialog `themeStore.startThemeFork` opens, from the rail's
 * picker or from a space's own list of themes. The host's, as {@link templateNameDialog} is — so a
 * template can offer a fork without being able to make a theme: it is made by a press here.
 */
export const themeNameDialog: SchemaNode = nameDialog({
  open: { $: 'themeStore.themeFork' },
  close: { $invoke: 'themeStore.cancelThemeFork' },
  title: { $: "themeStore.themeFork.source ? 'Fork theme' : 'New theme'" },
  initialName: { $: 'themeStore.themeFork.name' },
  initialIcon: { $: 'themeStore.themeFork.icon' },
  showDestination: true,
  confirmLabel: { $: "themeStore.themeFork.source ? 'Fork' : 'Create'" },
  confirm: ({ name, icon, destination }) => ({
    $invoke: 'themeStore.createAndStartEditing',
    args: [name, icon, { $: 'themeStore.themeFork.source' }, destination],
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
      { $if: { condition: { $: 'result' }, then: { $invoke: 'themeStore.cancelThemeFork' } } },
    ],
    onFinally: [{ $setLocal: 'saving', value: false }],
  }),
});
