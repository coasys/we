/**
 * The module rail — one place every feature module is opened from.
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
 * ## Why the right edge
 *
 * It is the emptiest edge in WE's layout: the sidebar owns the left, the header owns the top, and the
 * call bar owns the bottom centre. Docked module panels open beside it (`right: 48px`), so the rail
 * stays reachable while a panel is open rather than being covered by it.
 *
 * ## Only inside a space
 *
 * Module enablement is per-space, so outside one there is nothing to list — and `moduleLaunchers`
 * would be showing whatever the last space happened to enable.
 *
 * Inside one it always renders, even with no launchers at all. It used to disappear in that case, on
 * the reasoning that an empty strip of chrome is worse than none — true while the rail held nothing
 * but launchers, and wrong once it carries the way into the space's settings, which is where a
 * module gets turned back on. The empty state was the one state you could not escape from.
 */
import type { SchemaNode } from '@we/schema-shared';

/** The width every docked module panel should clear. Exported so panels stay in step with the rail. */
export const MODULE_RAIL_WIDTH = '48px';

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
        size: 'sm',
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

export const moduleRail: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'datasetStore.currentDataset' },
    then: {
      type: 'Column',
      props: {
        position: 'fixed',
        right: '0px',
        top: '96px',
        width: MODULE_RAIL_WIDTH,
        gap: '100',
        p: '100',
        ay: 'center',
        bg: 'neutral-0',
        border: '1px solid neutral-200',
        rtl: '400',
        rbl: '400',
        shadow: 'md',
        zIndex: 'sticky',
      },
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
                    size: 'sm',
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
            then: { type: 'we-divider', props: { width: '100%' } },
          },
        },
        spaceSettingsLauncher,
      ],
    },
  },
};
