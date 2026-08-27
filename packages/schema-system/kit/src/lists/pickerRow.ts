import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

import type { Content } from '../types.ts';

export interface PickerRowOptions {
  /** The row's icon — usually a reference, `{ $: 'theme.icon' }`. */
  icon: SchemaProp;
  label: Content;
  /** Truthy on the one row that is currently in use. */
  selected: SchemaProp;
  /** Truthy when this is the space's default, marked with a star rather than a word. */
  isDefault?: SchemaProp;
  /** What choosing the row does. Closing the popover around it is the caller's to add. */
  select: SchemaProp;
  /**
   * Per-row actions, shown to the right of the label.
   *
   * Each takes the row as its subject, which is the point of putting them here: the controls they
   * replace acted on whatever was *currently* selected, so editing something you were not already
   * using meant selecting it first and then finding the control again.
   */
  actions?: {
    icon: string;
    /**
     * The icon's weight. Defaults to regular, which is right for a verb — "edit this", "fork this".
     *
     * `fill` is for the other kind of action: one whose presence reports a state that is currently
     * true and whose click turns it off. Filled is already how this row says "true" — the star on
     * the space's default is filled — so a solid glyph beside a hollow one reads as a state rather
     * than as an offer, which is the difference between "unpin this" and "pin this".
     */
    weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
    tooltip: string;
    onClick: SchemaProp;
    /**
     * Show this action only when the expression is truthy.
     *
     * Not decoration: "edit" is not offered for every row. A built-in theme has nothing editable,
     * and a template can only be edited where the session says it is not read-only — gates the old
     * menus applied before showing the item, and dropping them would offer an edit that silently
     * does nothing.
     */
    when?: SchemaProp;
  }[];
}

/**
 * One row of a picker: an icon, a name, and the things you can do to it.
 *
 * Exists because there were four of these — templates, space themes, installed themes, built-in
 * themes — written out four times in one file, and they had already drifted: only some of them
 * marked the space default, and the selected-row background was spelled two ways.
 *
 * The label is a `bare` button rather than a `Row` with an `onClick`, so choosing a row keeps
 * keyboard activation and a real button role, and the per-row actions can be real buttons beside it
 * rather than click handlers nested inside another click handler.
 *
 * Actions are always visible rather than revealed on hover. A hover affordance in a list this
 * narrow is invisible on a touchscreen and undiscoverable everywhere else; low-contrast icons cost
 * less than a control nobody finds.
 */
export function pickerRow(opts: PickerRowOptions): SchemaNode {
  return {
    type: 'Row',
    props: {
      ay: 'center',
      gap: '100',
      px: '200',
      py: '100',
      r: '200',
      bg: expr`${opts.selected} ? 'primary-100' : 'transparent'`,
      // Static, like the rows this replaces. A token nested inside `hoverProps` resolves to an
      // accessor the style layer does not call, so a conditional here would be a hover colour that
      // silently never applied — and the selected row briefly reading as unselected under the
      // pointer is the same thing the old rows did.
      hoverProps: { bg: 'surface-hover' },
    },
    children: [
      {
        type: 'we-button',
        props: { variant: 'bare', flex: '1', onClick: opts.select },
        children: [
          {
            type: 'Row',
            props: { ay: 'center', gap: '200', width: '100%' },
            children: [
              { type: 'we-icon', props: { name: opts.icon, size: 'sm', color: 'text-muted' } },
              { type: 'we-text', props: { color: 'text', truncate: true, flex: '1' }, children: [opts.label] },
              {
                type: '$if',
                props: {
                  condition: opts.isDefault ?? false,
                  then: {
                    type: 'we-tooltip',
                    props: { title: "This space's default", placement: 'top' },
                    children: [{ type: 'we-icon', props: { name: 'star', weight: 'fill', color: 'warning-text' } }],
                  },
                },
              },
            ],
          },
        ],
      },
      ...(opts.actions ?? []).map((action) => {
        const button: SchemaNode = {
          type: 'we-tooltip',
          props: { title: action.tooltip, placement: 'top' },
          children: [
            {
              type: 'we-button',
              props: {
                variant: 'ghost',
                square: true,
                size: 'sm',
                color: 'text-faint',
                hoverProps: { color: 'text' },
                onClick: action.onClick,
              },
              children: [{ type: 'we-icon', props: { name: action.icon, weight: action.weight ?? 'regular' } }],
            },
          ],
        };
        return action.when === undefined ? button : { type: '$if', props: { condition: action.when, then: button } };
      }),
    ],
  };
}
