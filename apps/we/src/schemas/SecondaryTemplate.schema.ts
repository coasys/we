import type { TemplateSchema } from '@we/schema-renderer/shared';

const templateSidebar = {
  type: 'Column',
  props: { bg: 'ui-0', p: '500', ay: 'between' },
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
          type: '$forEach',
          props: { items: { $store: 'adamStore.mySpaces' }, as: 'space' },
          children: [
            {
              type: 'CircleButton',
              props: {
                label: { $expr: 'space.name' },
                onClick: { $action: 'routeStore.navigate', args: [{ $expr: '`/space/${space.uuid}`' }] },
              },
            },
          ],
        },
        {
          type: 'CircleButton',
          props: {
            label: 'Change label...',
            icon: 'plus',
            onClick: { $action: 'templateStore.changeNestedSchemaProp' },
          },
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

const templateHeader = {
  type: 'Row',
  props: { p: '400', gap: '400', ax: 'end', ay: 'center' },
  children: [
    {
      type: 'PopoverMenu',
      props: {
        options: { $store: 'themeStore.themes' },
        selectedOption: { $store: 'themeStore.currentTheme' },
        onSelect: { $store: 'themeStore.setCurrentTheme' },
      },
    },
    {
      type: 'PopoverMenu',
      props: {
        options: { $store: 'templateStore.templates' },
        selectedOption: { $store: 'templateStore.selectedTemplate' },
        onSelect: { $store: 'templateStore.switchTemplate' },
      },
    },
  ],
};

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
            save: { $action: 'adamStore.addNewSpace' },
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
  props: { bg: 'ui-100', p: '400', gap: '400', ay: 'center' },
  children: [
    { type: 'we-text', props: { size: '600' }, children: ['Space route'] },
    {
      type: 'we-button',
      props: {
        variant: 'subtle',
        onClick: { $action: 'routeStore.navigate', args: ['.'] },
      },
      children: ['About'],
    },
    {
      type: 'we-button',
      props: {
        variant: 'subtle',
        onClick: { $action: 'routeStore.navigate', args: ['./posts'] },
      },
      children: ['Posts'],
    },
    {
      type: 'we-button',
      props: {
        variant: 'subtle',
        onClick: { $action: 'routeStore.navigate', args: ['./users'] },
      },
      children: ['Users'],
    },
  ],
};

export const secondaryTemplateSchema: TemplateSchema = {
  meta: {
    name: 'Secondary',
    description: 'A simple template with a sidebar, header, and page area.',
    icon: 'sidebar',
  },
  type: 'DefaultTemplate',
  slots: { modals: templateModals }, // sidebar: templateSidebar // header: templateHeader,
  children: [{ type: '$routes' }],
  routes: [
    { path: '*', type: 'PageNotFound' },
    { path: '/', type: 'HomePage' },
    {
      path: '/space/:spaceId',
      type: 'SpacePage',
      slots: { sidebar: spacePageSidebar, header: spacePageHeader },
      children: [{ type: '$routes' }],
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
          props: { bg: 'ui-200', ay: 'center', px: '400', style: { height: '60px' } },
          children: [{ type: 'we-text', props: { size: '600' }, children: ['About sub-route'] }],
        },
        {
          path: '/posts',
          children: [
            {
              type: 'Row',
              props: { bg: 'ui-200', ay: 'center', gap: '400', px: '400', style: { height: '60px' } },
              children: [
                { type: 'we-text', props: { size: '600' }, children: ['Posts sub-route'] },
                {
                  type: 'we-button',
                  props: {
                    variant: 'subtle',
                    onClick: { $action: 'routeStore.navigate', args: ['./1'] },
                  },
                  children: ['Post 1'],
                },
                {
                  type: 'we-button',
                  props: {
                    variant: 'subtle',
                    onClick: { $action: 'routeStore.navigate', args: ['./2'] },
                  },
                  children: ['Post 2'],
                },
                {
                  type: 'we-button',
                  props: {
                    variant: 'subtle',
                    onClick: { $action: 'routeStore.navigate', args: ['../users'] },
                  },
                  children: ['Return back up to users'],
                },
              ],
            },
            {
              type: 'Column',
              props: { bg: 'ui-300', p: '400' },
              children: [{ type: '$routes' }],
            },
          ],
          routes: [
            { path: '/*', type: 'we-text', props: { size: '600' }, children: ['Post not found...'] },
            { path: '/', type: 'we-text', props: { size: '600' }, children: ['No posts selected...'] },
            { path: '/1', type: 'we-text', props: { size: '600' }, children: ['Post 1 sub-sub-route'] },
            { path: '/2', type: 'we-text', props: { size: '600' }, children: ['Post 2 sub-sub-route'] },
          ],
        },
        {
          path: '/users',
          type: 'Row',
          props: { bg: 'ui-200', ay: 'center', px: '400', style: { height: '60px' } },
          children: [{ type: 'we-text', props: { size: '600' }, children: ['User sub-route'] }],
        },
      ],
    },
  ],
};
