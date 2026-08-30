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
import { field, pickerPopover, pickerRow } from '@we/template-kit';

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

/** "My …" or "This space" — where a new template or theme is saved. */
function destinationToggle(): SchemaNode {
  const option = (value: string, label: string): SchemaNode => ({
    type: 'we-button',
    props: {
      size: 'sm',
      variant: expr`local.destination == ${value} ? 'secondary' : 'ghost'`,
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
 * The name-and-icon dialog both "New" and "Fork" open.
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
                  // locally judgeable beyond "is there one", and a rule here would exist only to
                  // drive this prop while offering to tell somebody their empty field is empty.
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

const templateRows = matching({ $: 'group.items' });

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
    children: [
      pickerPopover({
        openLocal: TEMPLATE_PICKER_OPEN,
        closeOthers: [THEME_PICKER_OPEN],
        icon: 'layout',
        tooltip: 'Template',
        searchPlaceholder: 'Search templates…',
        body: {
          type: '$each',
          props: { items: { $: 'templateStore.switcherGroups' }, as: 'group' },
          children: [
            section({ $: 'group.label' }, templateRows, {
              type: '$each',
              props: { items: templateRows, as: 'template' },
              children: [
                pickerRow({
                  icon: { $: 'template.icon' },
                  label: { $: 'template.name' },
                  selected: { $: 'template.id == templateStore.currentSwitcherId' },
                  isDefault: { $: 'template.id == spaceStore.spaceDefaultTemplateId' },
                  select: [
                    { $action: 'templateStore.switchTemplate', args: [{ $: 'template.id' }] },
                    closeTemplatePicker,
                  ],
                  actions: [
                    {
                      icon: 'pencil-simple',
                      tooltip: 'Edit this template',
                      /*
                        Any row that can be edited, not just the one already on screen.

                        This used to also require `$template.id` to be the current one, which made
                        editing anything else a three-step gesture: pick it, watch the menu close,
                        open the menu again, edit. The row's own pencil was right there on the first
                        pass and did nothing, which reads as the control being broken rather than as
                        a step being missing.

                        `editable` rather than `editorStore.isReadOnly`, because that answers for
                        whatever is currently rendered and every row would have got the same answer.
                        The guard is still needed — `enterTemplateEditing` has none of its own, so
                        offering this on a built-in opens a session over something that cannot be
                        saved.
                      */
                      when: { $: 'template.editable' },
                      // Switch first, exactly as forking does below: an editing session is opened
                      // over whatever is current, so editing a row you are not on has to make it
                      // current before entering.
                      onClick: [
                        { $action: 'templateStore.switchTemplate', args: [{ $: 'template.id' }] },
                        { $action: 'editorStore.enterTemplateEditing', args: ['edit'] },
                        closeTemplatePicker,
                      ],
                    },
                    {
                      icon: 'git-fork',
                      tooltip: 'Fork this template',
                      // Switch first: a fork is seeded from whatever is current, so forking a row you
                      // are not on has to make it current before asking for a name.
                      onClick: [
                        { $action: 'templateStore.switchTemplate', args: [{ $: 'template.id' }] },
                        { $action: 'editorStore.startFork' },
                        closeTemplatePicker,
                      ],
                    },
                  ],
                }),
              ],
            }),
          ],
        },
        footer: {
          type: 'we-button',
          props: {
            variant: 'ghost',
            width: '100%',
            ax: 'start',
            gap: '200',
            onClick: [{ $action: 'editorStore.startFresh' }, closeTemplatePicker],
          },
          children: [
            { type: 'we-icon', props: { name: 'plus' } },
            { type: 'we-text', children: ['New template'] },
          ],
        },
      }),

      nameDialog({
        open: { $: 'editorStore.pickerOpen' },
        close: { $action: 'editorStore.cancelPicker' },
        title: { $: "editorStore.pickerAction == 'fresh' ? 'New template' : 'Fork template'" },
        initialName: { $: 'editorStore.pickerDefaultName' },
        initialIcon: { $: 'editorStore.pickerDefaultIcon' },
        showDestination: { $: 'editorStore.pickerShowDestination' },
        confirmLabel: { $: "editorStore.pickerAction == 'fresh' ? 'Create' : 'Fork'" },
        confirm: ({ name, icon, destination }) => ({
          $action: 'editorStore.confirmPicker',
          args: [name, icon, destination],
          onFinally: [{ $setLocal: 'saving', value: false }],
        }),
      }),
    ],
  };
}

// ── Themes ──────────────────────────────────────────────────────────────────────────────────────

/** A theme section, over one of the three store arrays the themes are grouped into. */
function themeSection(label: string, storePath: string): SchemaNode {
  const rows = matching({ $: storePath });

  return section(label, rows, {
    type: '$each',
    props: { items: rows, as: 'theme' },
    children: [
      pickerRow({
        icon: iconOr('theme.icon', 'paint-bucket'),
        label: { $: 'theme.name' },
        selected: { $: 'theme.id == themeStore.currentThemeId' },
        isDefault: { $: 'theme.id == spaceStore.spaceDefaultThemeId' },
        // `applyTheme` rather than `themeStore.setCurrentTheme`: the choice is persisted where it was
        // made — pinned to this space, or set as the agent's default when there is no space — so it
        // survives everything that recomputes the space theme. Which of the two it is has to be
        // decided at click time, in the store; `$if` here would resolve once, at paint.
        //
        // Deliberately does *not* close the picker, unlike every other row in this file. The kit's
        // advice to close on select guards against a change hidden behind the surface that made it;
        // a theme repaints the whole window, this popover included, so the click is self-evidently
        // landed — and choosing a theme is the one thing here people do by comparison, trying three
        // in a row. Closing after each turned that into three round trips through the rail button.
        select: { $action: 'spaceStore.applyTheme', args: [{ $: 'theme.id' }] },
        actions: [
          /*
            The pin — a state, not an offer, which is why it is filled and why it appears on exactly
            one row: the theme this agent pinned *here*, when that pin actually diverges from what
            the space would otherwise show. Clicking it releases the pin.

            It replaces a "Pinned for this space · Reset" line in the footer. Same information, but
            attached to the row it is about rather than floating below a list where nothing said
            *which* theme was pinned — and it costs no vertical space in the common case, since it
            renders nothing when there is no pin to undo.
          */
          {
            icon: 'push-pin',
            weight: 'fill',
            tooltip: "Pinned to this space — unpin to follow the space's theme",
            when: { $: 'spaceStore.spaceThemePinned && theme.id == themeStore.currentThemeId' },
            onClick: { $action: 'spaceStore.clearSpaceThemePin' },
          },
          {
            icon: 'pencil-simple',
            tooltip: 'Edit this theme',
            // A built-in has no stored overrides to edit — forking is the way in, as it always was.
            when: { $: "theme.origin != 'built-in'" },
            onClick: [
              { $action: 'themeStore.setCurrentTheme', args: [{ $: 'theme.id' }] },
              { $action: 'themeStore.startEditing', args: [{ $: 'theme.id' }] },
              { $action: 'editorStore.enterThemeEditing' },
              closeThemePicker,
            ],
          },
          {
            icon: 'git-fork',
            tooltip: 'Fork this theme',
            // `from` rather than `value`: only `from` resolves a context ref, so this is how the row
            // being clicked reaches the dialog above. `value` would store the literal "$theme.id".
            onClick: [
              { $setLocal: 'forkSource', value: { $: 'theme.id' } },
              { $setLocal: 'forkName', value: { $: 'theme.name' } },
              { $setLocal: 'forkIcon', value: { $: 'theme.icon' } },
              { $setLocal: 'forkOpen', value: true },
              closeThemePicker,
            ],
          },
        ],
      }),
    ],
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
    $localState: {
      forkOpen: { type: 'boolean', initial: false },
      forkSource: { type: 'string', initial: '' },
      forkName: { type: 'string', initial: '' },
      forkIcon: { type: 'string', initial: 'paint-bucket' },
    },
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
                        onChange: { $action: 'themeStore.setSystemTheme', args: ['light', { $: 'arg.detail' }] },
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
                        onChange: { $action: 'themeStore.setSystemTheme', args: ['dark', { $: 'arg.detail' }] },
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
                onClick: [
                  { $setLocal: 'forkSource', value: '' },
                  { $setLocal: 'forkName', value: '' },
                  { $setLocal: 'forkIcon', value: 'paint-bucket' },
                  { $setLocal: 'forkOpen', value: true },
                  closeThemePicker,
                ],
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
                    onChange: { $action: 'themeStore.setThemeScopeGlobal', args: [{ $: 'event.detail' }] },
                  },
                },
              ],
            },
          ],
        },
      }),

      nameDialog({
        open: { $: 'local.forkOpen' },
        close: { $setLocal: 'forkOpen', value: false },
        title: { $: "local.forkSource ? 'Fork theme' : 'New theme'" },
        initialName: { $: 'local.forkName' },
        initialIcon: { $: 'local.forkIcon' },
        showDestination: true,
        confirmLabel: { $: "local.forkSource ? 'Fork' : 'Create'" },
        confirm: ({ name, icon, destination }) => ({
          $action: 'themeStore.createAndStartEditing',
          args: [name, icon, { $: 'local.forkSource' }, destination],
          // Resolves `false` when the create failed rather than rejecting, so the close and the mode
          // switch are guarded on the result — otherwise a failed create closes over its own error.
          onSuccess: [
            {
              $if: {
                condition: { $: 'result' },
                then: { $action: 'editorStore.enterThemeEditing' },
              },
            },
            { $if: { condition: { $: 'result' }, then: { $setLocal: 'forkOpen', value: false } } },
          ],
          onFinally: [{ $setLocal: 'saving', value: false }],
        }),
      }),
    ],
  };
}
