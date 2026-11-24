import type { TemplateSchema } from '@we/schema-shared';

/**
 * The project itself — its meta record and its members.
 *
 * v0 is read-only: the project name from `AcornProjectMeta`, and the roster from
 * `AcornProfile`. Editing the meta, the member roles and the mount settings land with the
 * write path in S2-5.
 */
export const acornSettingsView: TemplateSchema = {
  meta: {
    name: 'Project',
    description: 'The mounted project — its metadata and its member roster',
    icon: 'users-three',
    role: 'view',
    segment: 'project',
    requires: { modules: ['acorn'] },
  },
  // The section wears Acorn itself, so it looks the same inside any shell.
  theme: { themeName: 'acorn' },
  type: 'Column',
  props: {
    bg: 'page',
    minHeight: '100%',
    p: '500',
    gap: '400',
    width: '100%',
    maxWidth: 'var(--we-layout-lg)',
    mx: 'auto',
  },
  children: [
    {
      type: '$each',
      props: { items: { $query: { entity: 'AcornProjectMeta' } }, as: 'meta' },
      children: [
        {
          type: 'Column',
          props: { gap: '100' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: 'xl', fontWeight: 'bold' },
              children: [{ $: 'meta.name' }],
            },
            {
              type: 'we-text',
              props: { fontSize: 'sm', tone: 'secondary' },
              children: [{ $: '`Layering: ${meta.layeringAlgorithm}`' }],
            },
          ],
        },
      ],
    },
    {
      type: 'we-text',
      props: { fontWeight: 'semibold' },
      children: ['Members'],
    },
    {
      type: '$each',
      props: { items: { $query: { entity: 'AcornProfile', order: { handle: 'asc' } } }, as: 'profile' },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center', p: '300', bg: 'surface', r: 'surface', width: '100%' },
          children: [
            { type: 'we-avatar', props: { initials: { $: 'profile.handle' }, size: 'md' } },
            {
              type: 'Column',
              props: { gap: '0' },
              children: [
                {
                  type: 'we-text',
                  props: { fontWeight: 'medium' },
                  children: [{ $: '`${profile.firstName} ${profile.lastName}`' }],
                },
                {
                  type: 'we-text',
                  props: { fontSize: 'sm', tone: 'secondary' },
                  children: [{ $: '`@${profile.handle}`' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
