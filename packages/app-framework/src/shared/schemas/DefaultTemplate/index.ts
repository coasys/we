import type { TemplateSchema } from '@we/schema-shared';

import { globeRoute } from './routes/GlobeRoute';
import { spaceRoute } from './routes/SpaceRoute';

export const defaultTemplate: TemplateSchema = {
  meta: {
    name: 'Default',
    description: 'Welcome screen with perspectives and spaces overview',
    icon: 'layout',
  },
  type: 'Row',
  props: { ml: '72px', height: '100vh' },
  children: [
    {
      type: 'CollapsibleSidebar',
      props: {
        bg: 'neutral-25',
        side: 'left',
        position: 'absolute',
        zIndex: 10,
        border: '0',
        itemPadding: '12px',
        centerItems: true,
        items: [
          {
            type: 'item',
            id: 'home',
            icon: 'house',
            label: 'Home',
            onClick: { $action: 'routeStore.navigate', args: ['/'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/'] },
          },
          {
            type: 'item',
            id: 'globe',
            icon: 'globe-hemisphere-west',
            label: 'Globe',
            onClick: { $action: 'routeStore.navigate', args: ['/globe'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/globe'] },
          },
          {
            type: 'item',
            id: 'graph',
            icon: 'graph',
            label: 'Graph',
            onClick: { $action: 'routeStore.navigate', args: ['/graph'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/graph'] },
          },
          {
            type: 'item',
            id: 'cards',
            icon: 'cards-three',
            label: 'Cards',
            onClick: { $action: 'routeStore.navigate', args: ['/cards'] },
            active: { $eq: [{ $store: 'routeStore.currentPath' }, '/cards'] },
          },
        ],
      },
    },
    { type: '$routes' },
  ],
  routes: [globeRoute, spaceRoute],
};
