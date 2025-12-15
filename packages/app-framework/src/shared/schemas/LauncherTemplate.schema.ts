import type { TemplateSchema } from '@we/schema-renderer/shared';

const isDev = (import.meta as { env?: { DEV?: boolean } }).env?.DEV ?? false;
const FLUX_URL = isDev
  ? 'http://localhost:3030' // Vite dev server (HMR, fast iteration)
  : 'http://localhost:8080'; // Custom app server (serves bundled app without X-Frame-Options)

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
        src: FLUX_URL,
        title: 'Flux App',
        allow: 'camera; microphone; display-capture',
        width: '100%',
        height: '100%',
      },
    },
  ],
};
