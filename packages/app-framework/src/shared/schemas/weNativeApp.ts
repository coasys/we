/**
 * WE Native App Template
 * 
 * A native WE application with sidebar navigation and multiple views.
 * Built entirely from WE design system components - no embedded apps.
 */

import type { TemplateSchema } from '@we/schema-renderer/shared';

export const weNativeAppTemplateSchema: TemplateSchema = {
  meta: {
    name: 'WE Native App',
    description: 'Native WE application with sidebar navigation',
    icon: 'cube',
  },
  type: 'Row',
  props: {
    width: '100%',
    height: '100%',
  },
  children: [
    // Left sidebar
    {
      type: 'Column',
      props: {
        width: '200px',
        height: '100%',
        bg: 'ui-0',
        p: '1rem',
        gap: '0.5rem',
        borderRight: '1px solid',
        borderColor: 'ui-200',
      },
      children: [
        // App title
        {
          type: 'we-text',
          props: {
            text: 'WE Native',
            size: 'xl',
            weight: 'bold',
            mb: '1rem',
          },
        },
        // Navigation buttons
        {
          type: 'we-button',
          props: {
            width: '100%',
            onClick: { $action: 'routeStore.navigate', args: ['/'] },
            variant: 'ghost',
            justify: 'flex-start',
          },
          children: ['Globe'],
        },
        {
          type: 'we-button',
          props: {
            width: '100%',
            onClick: { $action: 'routeStore.navigate', args: ['/chat'] },
            variant: 'ghost',
            justify: 'flex-start',
          },
          children: ['Chat'],
        },
        {
          type: 'we-button',
          props: {
            width: '100%',
            onClick: { $action: 'routeStore.navigate', args: ['/profile'] },
            variant: 'ghost',
            justify: 'flex-start',
          },
          children: ['Profile'],
        },
      ],
    },
    // Right main panel
    {
      type: 'Column',
      props: {
        width: '100%',
        height: '100%',
        bg: 'ui-50',
      },
      children: [{ type: '$routes' }],
    },
  ],
  routes: [
    {
      path: '/',
      type: 'Column',
      props: {
        width: '100%',
        height: '100%',
      },
      children: [
        // Header section
        {
          type: 'Column',
          props: {
            width: '100%',
            p: '2rem',
            gap: '0.5rem',
            bg: 'ui-0',
            borderBottom: '1px solid',
            borderColor: 'ui-200',
          },
          children: [
            {
              type: 'we-text',
              props: {
                text: 'Globe View',
                size: '2xl',
                weight: 'bold',
              },
            },
            {
              type: 'we-text',
              props: {
                text: 'User locations around the world',
                size: 'lg',
                color: 'ui-600',
              },
            },
          ],
        },
        // Globe takes remaining space
        {
          type: 'CesiumGlobe',
          props: {
            width: '100%',
            height: 'calc(100vh - 200px)', // Full height minus header and padding
            locations: {
              $store: 'spaceStore.space.userLocations',
            },
          },
        },
      ],
    },
    {
      path: '/chat',
      type: 'Column',
      props: {
        width: '100%',
        height: '100%',
        p: '2rem',
      },
      children: [
        {
          type: 'we-text',
          props: {
            text: 'Chat View',
            size: '2xl',
            weight: 'bold',
          },
        },
      ],
    },
    {
      path: '/profile',
      type: 'Column',
      props: {
        width: '100%',
        height: '100%',
        p: '2rem',
      },
      children: [
        {
          type: 'we-text',
          props: {
            text: 'Profile View',
            size: '2xl',
            weight: 'bold',
          },
        },
      ],
    },
  ],
};
