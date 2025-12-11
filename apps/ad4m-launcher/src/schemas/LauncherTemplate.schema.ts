import type { TemplateSchema } from '@we/schema-renderer/shared';

export const launcherTemplate: TemplateSchema = {
  meta: { name: 'Launcher', description: 'Default templated for the launcher', icon: 'rocket-launch' },
  type: 'Row',
  props: { width: '100%' },
  children: [
    {
      type: 'Column',
      props: { width: '100px', bg: 'ui-0', p: '15px' },
      children: [
        {
          type: 'we-button',
          props: {
            width: '70px',
            height: '70px',
            r: 'full',
            onClick: { $action: 'routeStore.navigate', args: ['/'] },
            hoverProps: { bg: 'ui-200' },
          },
          children: ['Flux'],
        },
      ],
    },
    { type: 'Column', props: { width: '100%', bg: 'ui-50' }, children: [{ type: '$routes' }] },
  ],
  routes: [
    {
      path: '/',
      type: 'we-iframe',
      props: {
        src: 'http://localhost:4173',
        title: 'Flux App',
        allow: 'camera; microphone; display-capture',
        width: '100%',
        height: '100%',
      },
    },
  ],
};
