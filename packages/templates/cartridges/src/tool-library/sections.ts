/**
 * The tool library's sections: what can be borrowed, the lending desk, and what you have out.
 *
 * Transactional where the field guide is observational: availability is derived from open loans,
 * a borrow creates a loan linked to its item, and the desk moves loans between states.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { emptyNote, emptyState, recordFormModal } from '@we/template-kit';

import { addButton } from '../parts.ts';
import { CATEGORIES, OPEN } from './model.ts';

const page = { width: '100%', px: '600', py: '500', gap: '500' };
const openLoans = { entity: 'Loan', where: { status: [...OPEN] }, include: { item: true }, limit: 500 };
const filteredItems = "local.items.filter(i, local.category == '' || i.category == local.category)";

/** A loan's card: the item, who has it, when it is due, and what can happen to it next. */
const loanCard = (actions: TemplateSchema['children']) => ({
  type: 'Column',
  props: { bg: 'surface', r: 'surface', border: '1px solid border', p: '300', gap: '200' },
  children: [
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: [{ $: 'loan.item.name' }] },
    {
      type: '$agent',
      props: { did: { $: 'loan.borrower' }, as: 'who' },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-avatar', props: { size: 'xs', image: { $: 'who.avatar' }, hash: { $: 'who.did' } } },
            { type: 'we-text', props: { variant: 'footnote' }, children: [{ $: 'who.name' }] },
          ],
        },
      ],
    },
    {
      type: 'Row',
      props: { gap: '100', ay: 'center' },
      children: [
        { type: 'we-icon', props: { name: 'calendar', color: 'text-muted' } },
        { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: ['due '] },
        { type: 'we-timestamp', props: { value: { $: 'loan.dueDate' }, relative: true, color: 'text-muted' } },
      ],
    },
    ...(actions ?? []),
  ],
});

const setStatus = (label: string, status: string, variant = 'soft') => ({
  type: 'we-button',
  props: {
    size: 'sm',
    variant,
    onClick: { $invoke: 'record.update', args: ['Loan', { $: 'loan.id' }, { status }] },
  },
  children: [label],
});

export const catalogueSection: TemplateSchema & { id: string } = {
  id: 'tool-library-catalogue',
  meta: {
    name: 'Catalogue',
    description: 'Everything the library can lend',
    icon: 'squares-four',
    role: 'view',
    segment: 'catalogue',
  },
  type: 'Column',
  props: { width: '100%' },
  $queries: {
    items: { entity: 'Item', include: { photo: true }, order: { name: 'asc' }, limit: 300 },
    loans: openLoans,
  },
  $localState: { category: { type: 'string', initial: '', syncParam: 'category' } },
  children: [
    {
      type: 'Column',
      props: page,
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center', ax: 'between', wrap: true },
          children: [
            {
              type: 'Row',
              props: { gap: '200', wrap: true, flex: '1', minWidth: '0' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: { $: "local.category == '' ? 'solid' : 'outline'" },
                    onClick: { $setLocal: 'category', value: '' },
                  },
                  children: ['Everything'],
                },
                {
                  type: '$each',
                  props: { items: [...CATEGORIES], as: 'c' },
                  children: [
                    {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: { $: "local.category == c ? 'solid' : 'outline'" },
                        onClick: { $setLocal: 'category', value: { $: 'c' } },
                      },
                      children: [{ type: 'we-text', props: { textTransform: 'capitalize' }, children: [{ $: 'c' }] }],
                    },
                  ],
                },
              ],
            },
            addButton('Add an item', 'Item', 'plus'),
          ],
        },
        {
          type: '$if',
          props: {
            condition: { $: `local.itemsLoaded && !count(${filteredItems})` },
            then: emptyState({
              icon: 'wrench',
              label: 'items',
              message: {
                $: "local.category ? `Nothing in ${local.category} yet — add the first one.` : 'Nothing to lend yet — add the first item.'",
              },
            }),
          },
        },
        {
          type: 'Grid',
          props: { minChildWidth: '200px', gap: '300', width: '100%' },
          children: [
            {
              type: '$each',
              props: {
                items: { $: filteredItems },
                as: 'it',
              },
              children: [
                {
                  type: 'Column',
                  props: { bg: 'surface', r: 'surface', border: '1px solid border', overflow: 'hidden' },
                  children: [
                    {
                      type: 'we-image',
                      props: {
                        src: { $: 'it.photo.src' },
                        alt: { $: 'it.name' },
                        fit: 'cover',
                        height: '110px',
                        width: '100%',
                      },
                    },
                    {
                      type: 'Column',
                      props: { p: '300', gap: '200' },
                      children: [
                        { type: 'we-text', props: { variant: 'heading-sm', tag: 'h3' }, children: [{ $: 'it.name' }] },
                        {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-muted' },
                          children: [{ $: 'it.description' }],
                        },
                        {
                          type: '$if',
                          props: {
                            condition: { $: 'local.loans.find(l, l.item.id == it.id)' },
                            then: {
                              type: 'Row',
                              props: { gap: '200', ay: 'center' },
                              children: [
                                {
                                  type: 'we-badge',
                                  props: { size: 'sm', tone: 'warning' },
                                  children: [{ $: 'local.loans.find(l, l.item.id == it.id).status' }],
                                },
                                {
                                  type: 'we-timestamp',
                                  props: {
                                    value: { $: 'local.loans.find(l, l.item.id == it.id).dueDate' },
                                    relative: true,
                                    color: 'text-muted',
                                  },
                                },
                              ],
                            },
                            else: {
                              type: 'Row',
                              props: { gap: '200', ay: 'center', ax: 'between' },
                              children: [
                                {
                                  type: 'we-badge',
                                  props: {
                                    size: 'sm',
                                    tone: { $: "it.condition == 'needs-repair' ? 'danger' : 'success'" },
                                  },
                                  children: [{ $: "it.condition == 'needs-repair' ? 'in repair' : 'available'" }],
                                },
                                {
                                  type: 'we-button',
                                  props: {
                                    size: 'sm',
                                    disabled: { $: "it.condition == 'needs-repair'" },
                                    onClick: {
                                      $invoke: 'record.create',
                                      args: [
                                        'Loan',
                                        { status: 'requested', borrower: { $: 'me.did' }, item: { $: 'it.id' } },
                                      ],
                                    },
                                  },
                                  children: ['Borrow'],
                                },
                              ],
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    recordFormModal({ entityPicker: false }),
  ],
};

export const deskSection: TemplateSchema & { id: string } = {
  id: 'tool-library-desk',
  meta: {
    name: 'Lending desk',
    description: 'Requests, loans out, and what is late',
    icon: 'clipboard-text',
    role: 'view',
    segment: 'desk',
  },
  type: 'Column',
  props: { width: '100%' },
  $queries: { loans: { ...openLoans, order: { dueDate: 'asc' } } },
  children: [
    {
      type: 'Grid',
      props: { ...page, columns: 3, gap: '400' },
      children: [
        {
          type: '$each',
          props: {
            items: [
              { key: 'requested', label: 'Requested', icon: 'hand' },
              { key: 'out', label: 'Out', icon: 'arrow-square-out' },
              { key: 'overdue', label: 'Overdue', icon: 'warning' },
            ],
            as: 'col',
          },
          children: [
            {
              type: 'Column',
              props: { gap: '300', bg: 'surface-sunken', r: 'surface', p: '300', minHeight: '300px' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center' },
                  children: [
                    {
                      type: 'we-icon',
                      props: {
                        name: { $: 'col.icon' },
                        color: { $: "col.key == 'overdue' ? 'danger-text' : 'text-muted'" },
                      },
                    },
                    { type: 'we-text', props: { variant: 'label', uppercase: true }, children: [{ $: 'col.label' }] },
                    {
                      type: 'we-badge',
                      props: { size: 'xs' },
                      children: [{ $: 'count(local.loans.filter(l, l.status == col.key))' }],
                    },
                  ],
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: 'local.loansLoaded && !count(local.loans.filter(l, l.status == col.key))' },
                    then: emptyNote('None'),
                  },
                },
                {
                  type: '$each',
                  props: { items: { $: 'local.loans.filter(l, l.status == col.key)' }, as: 'loan' },
                  children: [
                    loanCard([
                      {
                        type: '$if',
                        props: {
                          condition: { $: "loan.status == 'requested'" },
                          then: setStatus('Hand over', 'out', 'solid'),
                          else: setStatus('Returned', 'returned'),
                        },
                      },
                    ]),
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

export const mineSection: TemplateSchema & { id: string } = {
  id: 'tool-library-mine',
  meta: {
    name: 'My loans',
    description: 'What you have out or have asked for',
    icon: 'user',
    role: 'view',
    segment: 'mine',
  },
  type: 'Column',
  props: { width: '100%' },
  $queries: { loans: { ...openLoans, where: { status: [...OPEN], borrower: { $: 'me.did' } } } },
  children: [
    {
      type: 'Column',
      props: { ...page, maxWidth: 'var(--we-layout-sm)', gap: '300' },
      children: [
        {
          type: '$if',
          props: {
            condition: { $: 'count(local.loans)' },
            then: {
              type: 'Column',
              props: { gap: '300' },
              children: [
                { type: '$each', props: { items: { $: 'local.loans' }, as: 'loan' }, children: [loanCard([])] },
              ],
            },
            else: {
              type: 'we-text',
              props: { color: 'text-muted' },
              children: ['Nothing out. Have a look in the catalogue.'],
            },
          },
        },
      ],
    },
  ],
};
