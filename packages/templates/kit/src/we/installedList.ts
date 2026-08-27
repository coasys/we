import { cardList, cardShell, emptyState } from '@we/schema-kit';
import type { SchemaNode, SchemaProp } from '@we/schema-shared';

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
  /** The row's identity in apply/default comparisons — `$template.slug` vs `$theme.id`. */
  key: string;
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
      where: { name: { contains: { $local: 'searchText' } } },
      order: { createdAt: { $local: 'sortDirection' } },
    },
    as: opts.as,
    empty: emptyState({ icon: opts.emptyIcon, label: opts.label, searchable: true }),
    children: [
      cardShell({
        header: [
          {
            type: 'Row',
            props: { ax: 'between', ay: 'center', width: '100%' },
            children: [
              // Left: icon + name + author
              {
                type: '$agent',
                props: { did: `$${opts.as}.author`, as: `${opts.as}Author` },
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
                            children: [`$${opts.as}.name`],
                          },
                          {
                            type: 'we-text',
                            props: { variant: 'label' },
                            children: [{ $concat: ['@', `$${opts.as}Author.handle`] }],
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
                  // Apply — switch to this one (hidden if already active)
                  {
                    type: '$if',
                    props: {
                      condition: {
                        $ne: [opts.key, { $store: opts.activeStorePath }],
                      },
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
                      condition: {
                        $and: [
                          { $: 'spaceStore.currentSpace.author == me.did' },
                          { $ne: [opts.key, { $store: `spaceStore.currentSpace.${opts.defaultField}` }] },
                        ],
                      },
                      then: {
                        type: 'we-button',
                        props: {
                          variant: 'outline',
                          size: 'sm',
                          onClick: {
                            $action: 'model.update',
                            args: [
                              'Space',
                              { $store: 'spaceStore.currentSpace.id' },
                              { [opts.defaultField]: opts.key },
                            ],
                          },
                        },
                        children: ['Set as default'],
                      },
                    },
                  },
                  // Delete — only the author
                  {
                    type: '$if',
                    props: {
                      condition: {
                        $eq: [`$${opts.as}.author`, '$me.did'],
                      },
                      then: {
                        type: 'we-button',
                        props: {
                          variant: 'ghost',
                          size: 'sm',
                          onClick: {
                            $action: 'model.delete',
                            args: [opts.entity, `$${opts.as}.id`],
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
                children: [{ $concat: ['v', `$${opts.as}.version`] }],
              },
              {
                type: '$if',
                props: {
                  condition: {
                    $eq: [opts.key, { $store: `spaceStore.currentSpace.${opts.defaultField}` }],
                  },
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
