/**
 * Default Template — Space Detail Route (/space/:spaceId)
 *
 * Dynamic space page with cover image, avatar, tab navigation, and four
 * sub-routes: /about, /posts, /members, /signals.
 */

import type { RouteSchema } from '@we/schema-shared';

import { aboutRoute } from './routes/AboutRoute';
import { membersRoute } from './routes/MembersRoute';
import { postsRoute } from './routes/PostsRoute';
import { signalsRoute } from './routes/SignalsRoute';

export const spaceRoute: RouteSchema = {
  path: '/space/:spaceId',
  type: 'Column',
  props: { gap: '500', maxWidth: '900px', mx: 'auto', width: '100%' },
  children: [
    // Back link
    {
      type: 'we-button',
      props: {
        variant: 'ghost',
        text: '← Back',
        onClick: { $action: 'routeStore.navigate', args: ['/'] },
      },
    },

    // Cover image
    {
      type: 'EditableImage',
      props: {
        src: { $store: 'spaceStore.space.thumbnail' },
        alt: 'Cover image',
        fit: 'cover',
        width: '100%',
        height: '200px',
        r: '300',
        placeholderIcon: 'panorama',
        onImageChange: { $action: 'spaceStore.updateSpaceCoverImage', args: ['$arg'] },
      },
    },

    // Space avatar + name (overlapping cover)
    {
      type: 'Column',
      props: { mt: '-60px', gap: '100', px: '400' },
      children: [
        {
          type: 'EditableImage',
          props: {
            src: { $store: 'spaceStore.space.image' },
            alt: 'Space image',
            fit: 'cover',
            width: '120px',
            height: '120px',
            r: '300',
            placeholderIcon: 'buildings',
            onImageChange: { $action: 'spaceStore.updateSpaceImage', args: ['$arg'] },
          },
        },
        {
          type: 'Column',
          props: { gap: '100', mt: '200' },
          children: [
            {
              type: 'we-text',
              props: { fontSize: '800', fontWeight: 'bold' },
              children: [{ $store: 'spaceStore.space.name' }],
            },
            {
              type: '$if',
              props: {
                condition: { $store: 'spaceStore.space.description' },
                then: {
                  type: 'we-text',
                  props: { fontSize: '400', color: 'neutral-500' },
                  children: [{ $store: 'spaceStore.space.description' }],
                },
              },
            },
          ],
        },
      ],
    },

    // Tab navigation
    {
      type: 'we-tabs',
      props: { selectedKey: { $store: 'routeStore.segments.2' } },
      children: [
        {
          type: 'we-tab',
          props: {
            key: 'about',
            label: 'About',
            onClick: { $action: 'routeStore.navigate', args: ['./about'] },
          },
        },
        {
          type: 'we-tab',
          props: {
            key: 'posts',
            label: 'Posts',
            onClick: { $action: 'routeStore.navigate', args: ['./posts'] },
          },
        },
        {
          type: 'we-tab',
          props: {
            key: 'members',
            label: 'Members',
            onClick: { $action: 'routeStore.navigate', args: ['./members'] },
          },
        },
        {
          type: 'we-tab',
          props: {
            key: 'signals',
            label: 'Signals',
            onClick: { $action: 'routeStore.navigate', args: ['./signals'] },
          },
        },
      ],
    },

    // Subroute outlet
    { type: '$routes' },
  ],
  routes: [
    // Default → redirect to about
    { path: '/', type: 'Column', redirect: './about' },
    postsRoute,
    signalsRoute,
    membersRoute,
    aboutRoute,
  ],
};
