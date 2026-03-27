import type { TemplateSchema } from '@we/schema-shared';

const templateSidebar = {
  type: 'Column',
  props: { bg: 'neutral-0', p: '500', ay: 'between' },
  children: [
    {
      type: 'Column',
      props: { ax: 'center', gap: '500' },
      children: [
        {
          type: 'CircleButton',
          props: {
            label: 'Home',
            image: 'https://avatars.githubusercontent.com/u/34165012?s=200&v=4',
            onClick: { $action: 'routeStore.navigate', args: ['/'] },
          },
        },
        {
          type: 'CircleButton',
          props: {
            label: 'Search',
            icon: 'magnifying-glass',
            onClick: { $action: 'routeStore.navigate', args: ['/search'] },
          },
        },
        {
          type: '$each',
          props: { items: { $store: 'adamStore.mySpaces' }, as: 'space' },
          children: [
            {
              type: 'CircleButton',
              props: {
                label: '$space.name',
                onClick: { $action: 'routeStore.navigate', args: [{ $concat: ['/space/', '$space.uuid'] }] },
              },
            },
          ],
        },
      ],
    },
    {
      type: 'Column',
      props: { ax: 'center', gap: '500' },
      children: [
        {
          type: 'CircleButton',
          props: {
            label: 'New Space',
            icon: 'plus',
            onClick: { $action: 'modalStore.openModal', args: ['create-space'] },
          },
        },
      ],
    },
  ],
};

// const templateHeader = {
//   type: 'Row',
//   props: { p: '400', gap: '400', ax: 'end', ay: 'center' },
//   children: [
//     {
//       type: 'PopoverMenu',
//       props: {
//         options: { $store: 'themeStore.themes' },
//         selectedOption: { $store: 'themeStore.currentTheme' },
//         onSelect: { $store: 'themeStore.setCurrentTheme' },
//       },
//     },
//     {
//       type: 'PopoverMenu',
//       props: {
//         options: { $store: 'templateStore.templates' },
//         selectedOption: { $store: 'templateStore.selectedTemplate' },
//         onSelect: { $store: 'templateStore.switchTemplate' },
//       },
//     },
//   ],
// };

const templateModals = {
  children: [
    {
      type: '$if',
      props: {
        condition: { $store: 'modalStore.createSpaceModalOpen' },
        then: {
          type: 'CreateSpaceModalWidget',
          props: {
            adamClient: { $store: 'adamStore.adamClient' },
            close: { $action: 'modalStore.closeModal', args: ['create-space'] },
            addNewSpace: { $action: 'adamStore.addNewSpace' },
          },
        },
      },
    },
  ],
};

const spacePageSidebar = {
  type: 'SpaceSidebarWidget',
  props: {
    name: { $store: 'spaceStore.space.name' },
    description: { $store: 'spaceStore.space.description' },
  },
};

const spacePageHeader = {
  type: 'Row',
  props: { bg: 'neutral-100', p: '400', gap: '400', ay: 'center' },
  children: [
    { type: 'we-text', props: { fontSize: '600' }, children: ['Space page'] },
    {
      type: 'we-button',
      props: { onClick: { $action: 'routeStore.navigate', args: ['.'] } },
      children: ['About'],
    },
    {
      type: 'we-button',
      props: { onClick: { $action: 'routeStore.navigate', args: ['./posts'] } },
      children: ['Posts'],
    },
    {
      type: 'we-button',
      props: { onClick: { $action: 'routeStore.navigate', args: ['./users'] } },
      children: ['Users'],
    },
  ],
};

export const defaultTemplateSchema: TemplateSchema = {
  meta: {
    name: 'Default',
    description: 'A simple template with a sidebar, header, and page area.',
    icon: 'layout',
  },
  type: 'Row',
  props: { class: 'we-default-template', width: '100%', height: '100%' },
  children: [
    {
      type: 'aside',
      props: { class: 'we-default-template-sidebar' },
      children: [templateSidebar],
    },
    {
      type: 'Column',
      props: { class: 'we-default-template-content', ax: 'center', bg: 'neutral-50' },
      children: [{ type: 'main', props: { class: 'we-default-template-pages' }, children: [{ type: '$routes' }] }],
    },
    templateModals,
  ],
  routes: [
    {
      path: '*',
      type: 'Column',
      props: { ax: 'center', bg: 'neutral-0', p: '500' },
      children: [{ type: 'we-text', props: { fontSize: '600' }, children: ['Page not found :_('] }],
    },
    {
      path: '/',
      type: 'Column',
      props: { ax: 'center', bg: 'neutral-0', p: '500' },
      children: [{ type: 'we-text', props: { fontSize: '600' }, children: ['Home page!!!'] }],
    },
    {
      path: '/space/:spaceId',
      type: 'Row',
      props: { class: 'we-space-page', height: '100%' },
      children: [
        {
          type: 'aside',
          props: { class: 'we-space-page-sidebar' },
          children: [spacePageSidebar],
        },
        {
          type: 'Column',
          props: { class: 'we-space-page-content', bg: 'neutral-50' },
          children: [
            {
              type: 'header',
              props: { class: 'we-space-page-header' },
              children: [spacePageHeader],
            },
            { type: 'main', props: { class: 'we-space-page-sub-pages' }, children: [{ type: '$routes' }] },
          ],
        },
      ],
      routes: [
        {
          path: '/*',
          type: 'we-text',
          props: { size: '800' },
          children: ['Space page not found...!'],
        },
        {
          path: '/',
          type: 'Row',
          props: { bg: 'neutral-200', ay: 'center', px: '400', style: { height: '60px' } },
          children: [{ type: 'we-text', props: { fontSize: '600' }, children: ['About sub-page'] }],
        },
        {
          path: '/posts',
          children: [
            {
              type: 'Row',
              props: { bg: 'neutral-200', ay: 'center', gap: '400', px: '400', height: '60px' },
              children: [
                {
                  type: 'we-button',
                  props: { onClick: { $action: 'routeStore.navigate', args: ['./1'] } },
                  children: ['Post 1'],
                },
                {
                  type: 'we-button',
                  props: { onClick: { $action: 'routeStore.navigate', args: ['./2'] } },
                  children: ['Post 2'],
                },
                {
                  type: 'we-button',
                  props: { onClick: { $action: 'routeStore.navigate', args: ['../users'] } },
                  children: ['Return back up to users'],
                },
              ],
            },
            {
              type: 'Column',
              props: { bg: 'neutral-300', p: '400' },
              children: [{ type: '$routes' }],
            },
          ],
          routes: [
            { path: '/*', type: 'we-text', props: { fontSize: '600' }, children: ['Post not found...'] },
            { path: '/', type: 'we-text', props: { fontSize: '600' }, children: ['No posts selected...'] },
            { path: '/1', type: 'we-text', props: { fontSize: '600' }, children: ['Post 1 sub-sub-page'] },
            { path: '/2', type: 'we-text', props: { fontSize: '600' }, children: ['Post 2 sub-sub-page'] },
          ],
        },
        {
          path: '/users',
          type: 'Row',
          props: { bg: 'neutral-200', ay: 'center', px: '400', style: { height: '60px' } },
          children: [{ type: 'we-text', props: { fontSize: '600' }, children: ['User sub-page'] }],
        },
      ],
    },
  ],
};
