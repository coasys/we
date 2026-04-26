import type { TemplateSchema } from '@we/schema-shared';

import { homeRoute } from './routes/HomeRoute';
import { spaceRoute } from './routes/SpaceRoute';

export const defaultTemplate: TemplateSchema = {
  meta: {
    name: 'Default',
    description: 'Welcome screen with perspectives and spaces overview',
    icon: 'layout',
  },
  type: 'Column',
  props: { width: '100%', minHeight: '100%', ax: 'center', bg: 'neutral-50' },
  children: [
    {
      type: 'Column',
      props: { maxWidth: '1200px', width: '100%', bg: 'neutral-50', p: '500', gap: '400' },
      children: [{ type: '$routes' }],
    },
  ],
  routes: [homeRoute, spaceRoute],
};
