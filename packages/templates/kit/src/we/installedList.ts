import { cardList, cardShell, emptyState } from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

import { recordLink } from './recordLink.ts';

export interface InstalledListOptions {
  /** What the space holds — `Template` or `Theme`. */
  entity: string;
  /** Context key for one row (`template`, `theme`). Also names the byline context (`<as>Author`). */
  as: string;
  /** Plural noun for the empty state. */
  label: string;
  /** The empty state's icon — the type's own. */
  emptyIcon: string;
  /** The row avatar's icon prop — a literal for templates, the theme's own icon field for themes. */
  avatarIcon: SchemaProp;
  /** The row's identity in apply/default comparisons — `template.slug` vs `theme.id`, as an expression. */
  key: SchemaProp;
  /** Store path holding the currently applied id, for hiding the Apply button. */
  activeStorePath: string;
  /** Store action Apply invokes with the key. */
  applyAction: string;
  /** The Space field a space author sets as the default (`defaultTemplateId` / `defaultThemeId`). */
  defaultField: string;
  /** Store action re-pulling the space list after the author deletes a row. */
  refreshAction: string;
}

/**
 * The space's own installed templates or themes, one card per item, with
 * apply / set-as-default / author-delete controls.
 *
 * These were two ~160-line files identical after token substitution, and they
 * had already drifted the way copies do: the template delete re-pulled the
 * space list on success, the theme delete did not — so a deleted theme stayed
 * in every picker until the space reloaded. The axes that genuinely differ
 * are the options; the structure lives here once.
 */
export function installedList(opts: InstalledListOptions): SchemaNode {
  return cardList({
    query: {
      entity: opts.entity,
      where: { name: { contains: { $: 'local.searchText' } } },
      order: { createdAt: { $: 'local.sortDirection' } },
    },
    as: opts.as,
    empty: emptyState({ icon: opts.emptyIcon, label: opts.label, searchable: true }),
    children: [
      cardShell({
        // Templates and themes are records like any other, so they are gathered like any other —
        // the entity and the noun are already parameters here.
        drag: {
          entity: opts.entity,
          id: { $: `${opts.as}.id` },
          label: { $: `${opts.as}.name` },
          icon: opts.emptyIcon,
        },
        header: [
          {
            type: 'Row',
            props: { ax: 'between', ay: 'center', width: '100%' },
            children: [
              // Left: icon + name + author
              {
                type: '$agent',
                props: { did: { $: `${opts.as}.author` }, as: `${opts.as}Author` },
                children: [
                  {
                    type: 'Row',
                    props: { ay: 'center', gap: '300' },
                    children: [
                      {
                        type: 'we-avatar',
                        props: { icon: opts.avatarIcon, size: 'sm' },
                      },
                      {
                        type: 'Column',
                        props: { gap: '100' },
                        children: [
                          {
                            type: 'we-text',
                            props: { fontWeight: 'semibold' },
                            children: [{ $: `${opts.as}.name` }],
                          },
                          {
                            type: 'we-text',
                            props: { variant: 'label' },
                            children: [{ $: `'@' + ${opts.as}Author.handle` }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
              // Right: action buttons
              {
                type: 'Row',
                props: { gap: '100' },
                children: [
                  // The row's own page. Renders itself away outside a space, which this list also
                  // appears in — see `recordLink`.
                  recordLink({ $: `'${opts.entity}'` }, { $: `${opts.as}.id` }),
                  // Apply — switch to this one (hidden if already active)
                  {
                    type: '$if',
                    props: {
                      condition: expr`${opts.key} != ${{ $: opts.activeStorePath }}`,
                      then: {
                        type: 'we-button',
                        props: {
                          variant: 'ghost',
                          size: 'sm',
                          onClick: {
                            $action: opts.applyAction,
                            args: [opts.key],
                          },
                        },
                        children: ['Apply'],
                      },
                    },
                  },
                  // Set as default — only the space author, only if not already default
                  {
                    type: '$if',
                    props: {
                      condition: expr`spaceStore.currentSpace.author == me.did && ${opts.key} != ${{ $: `spaceStore.currentSpace.${opts.defaultField}` }}`,
                      then: {
                        type: 'we-button',
                        props: {
                          variant: 'outline',
                          size: 'sm',
                          onClick: {
                            $action: 'record.update',
                            args: ['Space', { $: 'spaceStore.currentSpace.id' }, { [opts.defaultField]: opts.key }],
                          },
                        },
                        children: ['Set as default'],
                      },
                    },
                  },
                  /*
                    Delete — whoever made it, or whoever runs the space.

                    This was `author == me.did` alone, which meant a template or theme installed
                    into a space by one member could not be removed by anybody else — the space's
                    own author included. `installToSpace` therefore had no way back: the copy it
                    made was permanent for everyone but the person who made it.

                    `canAdministerCurrentSpace` is the question the control is actually asking, and
                    an affordance rather than enforcement — a neighbourhood is writable by every
                    member, so this decides who is *offered* the button, not who could delete.
                  */
                  {
                    type: '$if',
                    props: {
                      condition: {
                        $: `${opts.as}.author == me.did || spaceStore.canAdministerCurrentSpace`,
                      },
                      then: {
                        type: 'we-button',
                        props: {
                          variant: 'ghost',
                          size: 'sm',
                          onClick: {
                            $action: 'record.delete',
                            args: [opts.entity, { $: `${opts.as}.id` }],
                            onSuccess: [{ $action: opts.refreshAction }],
                          },
                        },
                        children: [{ type: 'we-icon', props: { name: 'trash' } }],
                      },
                    },
                  },
                ],
              },
            ],
          },
        ],
        body: [
          {
            type: 'Row',
            props: { gap: '200', ay: 'center' },
            children: [
              {
                type: 'we-badge',
                props: { variant: 'neutral' },
                children: [{ $: `'v' + ${opts.as}.version` }],
              },
              {
                type: '$if',
                props: {
                  condition: expr`${opts.key} == ${{ $: `spaceStore.currentSpace.${opts.defaultField}` }}`,
                  then: {
                    type: 'we-badge',
                    props: { variant: 'primary' },
                    children: ['Space default'],
                  },
                },
              },
            ],
          },
        ],
      }),
    ],
  });
}
