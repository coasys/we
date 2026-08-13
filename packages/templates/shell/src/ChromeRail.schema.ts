/**
 * The chrome rail — one edge, holding everything the host puts on screen permanently.
 *
 * ## Why the host owns this
 *
 * The first two modules to need an entry point each invented their own: notes put a tab at the right
 * edge, calls put a pill in a corner. Both worked in isolation and looked like an accident together,
 * and a third module would have made it three. A module knows what its launcher *means*; only the
 * host knows where launchers go and can keep them from colliding.
 *
 * So a module declares `launcher: { icon, label, action }` and contributes no chrome for it. This
 * renders them all, in registration order with the same id tiebreak the slot registry uses, so the
 * rail cannot reshuffle depending on which module loaded first.
 *
 * ## Why it is no longer only about modules
 *
 * It never quite was — it has carried the way into a space's settings for as long as it has existed,
 * because that is where a module gets turned back on. It now also carries the template and theme
 * pickers, which used to be a strip of chips pinned to the top-right corner.
 *
 * Those chips were the one piece of persistent chrome no layout calculation knew about: `SIDEBAR_PX`
 * reserves the left edge and `contentInset` moves content out of a docked panel's way, but nothing
 * reserved the band across the top, so every template drew its own header into space the app believed
 * was free. Two pieces of chrome in two corners also meant two things to dodge; one rail is one.
 *
 * ## Why the right edge
 *
 * It is the emptiest edge in WE's layout: the sidebar owns the left and the call bar owns the bottom
 * centre. A docked module panel takes that edge outright and slides the rail inwards by its width, so
 * the rail stays reachable while a panel is open rather than being covered by it — and the panel is
 * not stranded in the middle of the edge with chrome on both sides.
 *
 * The editor's panels take the same edge and are painted above this, so they get the same treatment
 * through `--we-editor-right`. Without it, entering an editing session would hide the picker that
 * starts one.
 *
 * ## What is gated on what
 *
 * Module enablement is per-space, so outside a space there is nothing to list — `moduleLaunchers`
 * would be showing whatever the last space happened to enable — and there is no space to open
 * settings for. Both of those keep their gate.
 *
 * The design pickers do not. Which template you are looking at is a question with an answer on the
 * spaces list too, and the chips could be reached there; gating the whole rail on a current dataset
 * would have quietly removed that.
 */
import type { SchemaNode } from '@we/schema-shared';

import { TEMPLATE_PICKER_OPEN, templatePicker, THEME_PICKER_OPEN, themePicker } from './DesignControls.schema';

/**
 * The width every docked module panel should clear. Exported so panels stay in step with the rail.
 *
 * Derived, not chosen: a `md` square button is 40px and the rail pads it by `200` (8px) a side.
 * Change either and this has to move with it, or the buttons overflow a rail too narrow to hold them.
 */
export const CHROME_RAIL_WIDTH = '56px';

/**
 * Settings for the space you are standing in, one click away.
 *
 * The page it opens is the same one the spaces list reaches, addressed by the current dataset — so
 * there is one per-space settings surface rather than two that can drift. The overlay keeps the
 * space loaded underneath, which is what makes opening it from in here feel like a layer rather than
 * an exit.
 *
 * Outside the launcher list on purpose: it renders even when no module does. Gating it on having
 * launchers would remove the way back to the module settings in exactly the state — everything
 * turned off — where someone needs it.
 */
const spaceSettingsLauncher: SchemaNode = {
  type: 'we-tooltip',
  props: { title: 'Space settings', placement: 'left' },
  children: [
    {
      type: 'we-button',
      props: {
        square: true,
        variant: 'ghost',
        onClick: {
          $action: 'shellStore.openShellView',
          args: ['settings', { $concat: ['/spaces/', { $store: 'datasetStore.currentDataset.id' }] }],
        },
      },
      children: [{ type: 'we-icon', props: { name: 'gear' } }],
    },
  ],
};

/**
 * The launchers, and the way into the settings that turn them on. Only inside a space.
 *
 * Wrapped as one section rather than gated individually so the divider below it can be gated on the
 * same answer — an empty rail with a stray horizontal line in it was the shape this took the first
 * time the two were gated apart.
 */
const spaceSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'datasetStore.currentDataset' },
    then: {
      type: 'Column',
      props: { gap: '100', ay: 'center', width: '100%' },
      children: [
        {
          type: '$each',
          props: { items: { $store: 'spaceStore.moduleLaunchers' }, as: 'mod' },
          children: [
            {
              type: 'we-tooltip',
              props: { title: '$mod.label', placement: 'left' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    square: true,
                    // Highlighted while the module reports itself open, which is what makes the
                    // rail read as a set of tabs rather than a row of buttons.
                    variant: { $if: { condition: '$mod.active', then: 'secondary', else: 'ghost' } },
                    // The id is passed rather than a path: `$action` resolves a literal string, so
                    // a rail iterating over modules cannot build `modules.<id>.<method>` itself.
                    onClick: { $action: 'spaceStore.launchModule', args: ['$mod.id'] },
                  },
                  children: [{ type: 'we-icon', props: { name: '$mod.icon' } }],
                },
              ],
            },
          ],
        },
        // Separated from the launchers only when there are some to separate from.
        {
          type: '$if',
          props: {
            condition: { $count: { items: { $store: 'spaceStore.moduleLaunchers' } } },
            then: { type: 'we-divider', props: { width: '100%', my: '100' } },
          },
        },
        spaceSettingsLauncher,
        { type: 'we-divider', props: { width: '100%', my: '100' } },
      ],
    },
  },
};

/**
 * The template and theme pickers.
 *
 * Hidden while an external app or a shell overlay is up, which is the rule the chips they replace
 * followed: both of those cover the template, so a control for choosing which template is underneath
 * is offering to change something you cannot see.
 */
const designSection: SchemaNode = {
  type: '$if',
  props: {
    condition: {
      $and: [{ $not: { $store: 'appStore.activeAppId' } }, { $not: { $store: 'shellStore.activeShellView' } }],
    },
    then: {
      type: 'Column',
      props: { gap: '100', ay: 'center', width: '100%' },
      // Both flags live here, above either picker, so opening one can close the other. Held by the
      // thing that knows they are a set — neither picker can see the other's state.
      $localState: {
        [TEMPLATE_PICKER_OPEN]: { type: 'boolean', initial: false },
        [THEME_PICKER_OPEN]: { type: 'boolean', initial: false },
      },
      children: [templatePicker(), themePicker()],
    },
  },
};

export const chromeRail: SchemaNode = {
  type: '$if',
  props: {
    // Nothing here means anything before the app is up, and the boot screen owns the whole window.
    condition: { $eq: [{ $store: 'sessionStore.bootState' }, 'ready'] },
    then: {
      type: 'Column',
      props: {
        position: 'fixed',
        /*
          Against the content's edge rather than the window's, so chrome that takes this edge slides
          the rail inwards instead of opening on top of it.

          Two things can: a docked module panel (`--we-dock-right`, set by ShellStore) and the
          editor's own panel stack (`--we-editor-right`, set by RightPanelContainer). The editor
          paints above this rail, so without its term the pickers would be covered by the editing
          session they start — the exact failure that moving them here was meant to end.
        */
        right: 'calc(var(--we-dock-right, 0px) + var(--we-editor-right, 0px))',
        top: '16px',
        width: CHROME_RAIL_WIDTH,
        gap: '100',
        p: '200',
        ay: 'center',
        bg: 'neutral-50',
        border: '1px solid neutral-200',
        rtl: '400',
        rbl: '400',
        shadow: 'md',
        zIndex: 'sticky',
        transition: 'right var(--we-chrome-transition, 300ms) ease',
      },
      children: [spaceSection, designSection],
    },
  },
};
