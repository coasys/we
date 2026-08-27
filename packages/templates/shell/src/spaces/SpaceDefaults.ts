import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import { marketplaceBrowser } from './vocabulary/MarketplaceBrowser.ts';
import { themeMarketplaceBrowser } from './vocabulary/ThemeMarketplaceBrowser.ts';

/**
 * What members get when they first open this space — its default template and theme.
 *
 * Moved here from the default template's own `/settings` route, where it had a problem it could not
 * fix from the inside: a space whose template does not provide a settings page had no way to change
 * its template. The escape hatch has to live outside the thing it rescues, and this page is already
 * outside every template.
 *
 * The row generator is shared between templates and themes because they had drifted apart when they
 * were written out twice — one compared `$template.id` against the space default, the other compared
 * `$template.slug`, and only one of them was right.
 */
const defaultPickerRow = (opts: {
  as: string;
  icon: SchemaProp;
  name: string;
  currentDefault: string;
  setDefault: string;
}): SchemaNode => {
  const isDefault = { $eq: [`$${opts.as}.id`, opts.currentDefault] };

  return {
    type: 'Row',
    props: {
      ay: 'center',
      ax: 'between',
      p: '300',
      r: '300',
      bg: { $if: { condition: isDefault, then: 'surface-active', else: 'page' } },
    },
    children: [
      {
        type: 'Row',
        props: { ay: 'center', gap: '300' },
        children: [
          { type: 'we-icon', props: { name: opts.icon } },
          { type: 'we-text', props: { fontWeight: 'semibold' }, children: [opts.name] },
        ],
      },
      {
        type: '$if',
        props: {
          condition: isDefault,
          /*
            The current default states itself with a badge rather than a disabled button: there is
            nothing to press on the row you are already using, and a greyed-out "Set as default"
            invites the press anyway.
          */
          then: { type: 'we-badge', props: { variant: 'primary', size: 'sm' }, children: ['Default'] },
          else: {
            type: '$if',
            props: {
              condition: '$space.canAdminister',
              then: {
                type: 'we-button',
                props: {
                  variant: 'secondary',
                  size: 'sm',
                  // The space is named explicitly. On the route this replaced it could be omitted,
                  // because there was only ever one space in question; here the row being configured
                  // is usually not the one on screen.
                  onClick: { $action: opts.setDefault, args: [`$${opts.as}.id`, '$space.uuid'] },
                },
                children: ['Set as default'],
              },
            },
          },
        },
      },
    ],
  };
};

const templateRow = defaultPickerRow({
  as: 'template',
  icon: '$template.meta.icon',
  name: '$template.meta.name',
  // The row's own space, not `spaceStore.spaceDefaultTemplateId` — that reads the space on screen,
  // which would mark the wrong row as default on every other space's page.
  currentDefault: '$space.defaultTemplateId',
  setDefault: 'spaceStore.setSpaceDefaultTemplate',
});

const themeRow = defaultPickerRow({
  as: 'theme',
  icon: '$theme.icon',
  name: '$theme.name',
  currentDefault: '$space.defaultThemeId',
  setDefault: 'spaceStore.setSpaceDefaultTheme',
});

const sectionBox = (title: string, description: string, children: SchemaNode[]): SchemaNode => ({
  type: 'Column',
  props: { gap: '300', p: '400', bg: 'surface-sunken', r: '300', border: '1px solid border' },
  children: [
    {
      type: 'Column',
      props: { gap: '100' },
      children: [
        { type: 'we-text', props: { variant: 'label' }, children: [title] },
        { type: 'we-text', props: { variant: 'footnote', color: 'text-faint' }, children: [description] },
      ],
    },
    ...children,
  ],
});

const group = (label: string, items: SchemaProp, as: string, row: SchemaNode): SchemaNode => ({
  type: 'Column',
  props: { gap: '200' },
  children: [
    {
      type: 'we-text',
      props: { variant: 'footnote', fontWeight: 'semibold', textTransform: 'uppercase', color: 'text-faint' },
      children: [label],
    },
    { type: '$each', props: { items, as }, children: [row] },
  ],
});

/** Browse-and-install, shown only to whoever may change what everyone sees. */
const browseToggle = (localFlag: string, browser: SchemaNode): SchemaNode => ({
  type: '$if',
  props: {
    condition: '$space.canAdminister',
    then: {
      type: 'Column',
      props: { gap: '200' },
      children: [
        {
          type: 'we-button',
          props: { variant: 'secondary', size: 'sm', onClick: { $toggleLocal: localFlag } },
          children: [
            {
              $if: {
                condition: { $local: localFlag },
                then: 'Hide',
                else: 'Browse the marketplace',
              },
            },
          ],
        },
        { type: '$if', props: { condition: { $local: localFlag }, then: browser } },
      ],
    },
  },
});

export const spaceDefaultsSection: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  $localState: {
    showMarketplace: { type: 'boolean', initial: false },
    showThemeMarketplace: { type: 'boolean', initial: false },
  },
  children: [
    sectionBox('Default template', 'The interface members get when they open this space.', [
      group('Built-in', { $store: 'templateStore.builtInTemplates' }, 'template', templateRow),
      {
        type: '$if',
        props: {
          condition: { $: 'count(templateStore.spaceTemplates)' },
          then: group('In this space', { $store: 'templateStore.spaceTemplates' }, 'template', templateRow),
        },
      },
      browseToggle('showMarketplace', marketplaceBrowser),
    ]),
    sectionBox('Default theme', 'The look members get when they open this space.', [
      group('Built-in', { $store: 'themeStore.builtInThemes' }, 'theme', themeRow),
      /*
        "Follow system" is not a built-in theme — it resolves to one rather than being one, which is
        why `themeStore` keeps it in a list of its own — but it is a choice made in the same place,
        so it is offered here under its own heading rather than dropped.

        Here it means "this space's default is: follow each member's own system". *Which two themes*
        that picks between is each member's own setting and lives in the shell's picker; a control
        for it in a space's settings would let a community repoint what "Follow system" means for
        everybody who opened their template.
      */
      group('Automatic', { $store: 'themeStore.automaticThemes' }, 'theme', themeRow),
      {
        type: '$if',
        props: {
          condition: { $: 'count(themeStore.spaceThemes)' },
          then: group('In this space', { $store: 'themeStore.spaceThemes' }, 'theme', themeRow),
        },
      },
      browseToggle('showThemeMarketplace', themeMarketplaceBrowser),
    ]),
  ],
};
