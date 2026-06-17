import type { RouteSchema } from '@we/schema-shared';

export const settingsRoute: RouteSchema = {
  path: '/settings',
  type: 'Column',
  props: { width: '100%', ax: 'center', height: 'calc(100vh - 72px)' },
  children: [
    {
      type: '$single',
      props: {
        item: {
          $query: {
            model: 'Space',
            where: { url: { $store: 'adamStore.currentPerspectiveSharedCid' } },
          },
        },
        as: 'space',
      },
      children: [
        {
          type: 'Column',
          props: { width: '100%', maxWidth: '1200px', gap: '500', px: '400', pt: '500' },
          children: [
            // ─── Default Template ─────────────────────────────────────────────────────
            {
              type: 'Column',
              props: { gap: '400', p: '500', bg: 'neutral-100', r: '400', border: '1px solid neutral-200' },
              children: [
                {
                  type: 'Column',
                  props: { gap: '100' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '700', fontWeight: 'bold', color: 'primary-700' },
                      children: ['Default Template'],
                    },
                    {
                      type: 'we-text',
                      props: { color: 'neutral-600' },
                      children: ['Choose the template members see when they enter this space.'],
                    },
                  ],
                },

                // Space templates (saved directly to this space)
                {
                  type: '$if',
                  props: {
                    condition: {
                      $gt: [{ $count: { items: { $store: 'templateStore.spaceTemplates' } } }, 0],
                    },
                    then: {
                      type: 'Column',
                      props: { gap: '200' },
                      children: [
                        {
                          type: 'we-text',
                          props: { fontSize: '400', fontWeight: '600', color: 'neutral-500' },
                          children: ['SPACE TEMPLATES'],
                        },
                        {
                          type: '$each',
                          props: { items: { $store: 'templateStore.spaceTemplates' }, as: 'tmpl' },
                          children: [
                            {
                              type: 'Row',
                              props: {
                                ay: 'center',
                                ax: 'between',
                                p: '300',
                                r: '300',
                                border: '1px solid neutral-200',
                                bg: {
                                  $if: {
                                    condition: { $eq: ['$tmpl.id', '$space.defaultTemplateId'] },
                                    then: 'primary-50',
                                    else: 'neutral-0',
                                  },
                                },
                              },
                              children: [
                                {
                                  type: 'Row',
                                  props: { ay: 'center', gap: '300' },
                                  children: [
                                    { type: 'we-icon', props: { name: '$tmpl.meta.icon' } },
                                    {
                                      type: 'we-text',
                                      props: { fontWeight: '600' },
                                      children: ['$tmpl.meta.name'],
                                    },
                                  ],
                                },
                                {
                                  type: '$if',
                                  props: {
                                    condition: { $eq: ['$tmpl.id', '$space.defaultTemplateId'] },
                                    then: {
                                      type: 'we-badge',
                                      props: { variant: 'primary' },
                                      children: ['Default'],
                                    },
                                    else: {
                                      type: 'we-button',
                                      props: {
                                        variant: 'secondary',
                                        size: 'sm',
                                        onClick: {
                                          $action: 'model.update',
                                          args: ['Space', '$space.id', { defaultTemplateId: '$tmpl.id' }],
                                        },
                                      },
                                      children: ['Set as default'],
                                    },
                                  },
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  },
                },

                // Personal + core templates
                {
                  type: 'Column',
                  props: { gap: '200' },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontSize: '400', fontWeight: '600', color: 'neutral-500' },
                      children: ['YOUR TEMPLATES'],
                    },
                    {
                      type: '$each',
                      props: { items: { $store: 'templateStore.personalTemplates' }, as: 'tmpl' },
                      children: [
                        {
                          type: 'Row',
                          props: {
                            ay: 'center',
                            ax: 'between',
                            p: '300',
                            r: '300',
                            border: '1px solid neutral-200',
                            bg: {
                              $if: {
                                condition: { $eq: ['$tmpl.id', '$space.defaultTemplateId'] },
                                then: 'primary-50',
                                else: 'neutral-0',
                              },
                            },
                          },
                          children: [
                            {
                              type: 'Row',
                              props: { ay: 'center', gap: '300' },
                              children: [
                                { type: 'we-icon', props: { name: '$tmpl.meta.icon' } },
                                {
                                  type: 'we-text',
                                  props: { fontWeight: '600' },
                                  children: ['$tmpl.meta.name'],
                                },
                              ],
                            },
                            {
                              type: '$if',
                              props: {
                                condition: { $eq: ['$tmpl.id', '$space.defaultTemplateId'] },
                                then: {
                                  type: 'we-badge',
                                  props: { variant: 'primary' },
                                  children: ['Default'],
                                },
                                else: {
                                  type: 'we-button',
                                  props: {
                                    variant: 'secondary',
                                    size: 'sm',
                                    onClick: {
                                      $action: 'model.update',
                                      args: ['Space', '$space.id', { defaultTemplateId: '$tmpl.id' }],
                                    },
                                  },
                                  children: ['Set as default'],
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
      ],
    },
  ],
};
