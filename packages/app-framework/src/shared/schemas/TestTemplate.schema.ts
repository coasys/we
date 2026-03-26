import type { TemplateSchema } from '@we/schema-shared';
import { updateSchema } from '@we/schema-solid';
import { SetStoreFunction } from 'solid-js/store';

import { deepClone } from '../utils';

// Schema fragments
const testButtons = {
  type: 'Row',
  props: { bg: 'ui-200', ay: 'center', gap: '400', p: '400' },
  children: [
    { type: 'we-text', props: { fontSize: '600' }, children: ['Testing buttons'] },
    // {
    //   type: 'we-button',
    //   props: { onClick: { $action: 'templateStore.changeNodeType' } },
    //   children: ['changeNodeType'],
    // },
    // {
    //   type: 'we-button',
    //   props: { onClick: { $action: 'templateStore.removeTemplateHeaderSlot' } },
    //   children: ['removeTemplateHeaderSlot'],
    // },
    // {
    //   type: 'we-button',
    //   props: { onClick: { $action: 'templateStore.addTemplateHeaderSlot' } },
    //   children: ['addTemplateHeaderSlot'],
    // },
    // {
    //   type: 'we-button',
    //   props: { onClick: { $action: 'templateStore.changeTemplateHeaderProp' } },
    //   children: ['changeTemplateHeaderProp'],
    // },
    // {
    //   type: 'we-button',
    //   props: { onClick: { $action: 'templateStore.changeTemplateHeaderChildProp' } },
    //   children: ['changeTemplateHeaderChildProp'],
    // },
    // {
    //   type: 'we-button',
    //   props: { onClick: { $action: 'templateStore.changeSidebarProp' } },
    //   children: ['changeSidebarProp'],
    // },
    // {
    //   type: 'we-button',
    //   props: { onClick: { $action: 'templateStore.editSpacePageHeaderButton' } },
    //   children: ['editSpacePageHeaderButton'],
    // },
    // {
    //   type: 'we-button',
    //   props: { onClick: { $action: 'templateStore.editPostsPageHeaderButton' } },
    //   children: ['editPostsPageHeaderButton'],
    // },
    // {
    //   type: 'we-button',
    //   props: { onClick: { $action: 'templateStore.addPostsPageHeaderButton' } },
    //   children: ['addPostsPageHeaderButton'],
    // },
    // {
    //   type: 'we-button',
    //   props: { onClick: { $action: 'templateStore.addSidebarButton' } },
    //   children: ['addSidebarButton'],
    // },
    // {
    //   type: 'we-button',
    //   props: { onClick: { $action: 'templateStore.createInvalidSchema' } },
    //   children: ['createInvalidSchema'],
    // },
    {
      type: 'we-button',
      props: { onClick: { $action: 'templateStore.addSidebarButton2' } },
      children: ['addSidebarButton2'],
    },
    // {
    //   type: 'we-button',
    //   props: { onClick: { $action: 'templateStore.addTwitterButton' } },
    //   children: ['addTwitterButton'],
    // },
  ],
};

const templateSidebar = {
  type: 'Column',
  props: { bg: 'ui-0', p: '500', ay: 'between' },
  children: [
    {
      type: 'Column',
      props: { ax: 'center', gap: '500' },
      children: [
        {
          type: 'we-button',
          // props: {
          //   bg: 'primary-100',
          //   color: 'danger-700',
          // },
          children: [{ type: 'we-icon', props: { name: 'house' } }, '1'],
        },
        {
          type: 'we-button',
          // props: {
          //   bg: 'primary-100',
          //   color: 'danger-700',
          // },
          children: [{ type: 'we-icon', props: { name: 'magnifying-glass' } }, '2'],
        },
        {
          type: 'we-button',
          // props: {
          //   bg: 'primary-100',
          //   color: 'danger-700',
          // },
          children: [{ type: 'we-icon', props: { name: 'bell' } }, '3'],
        },
        {
          type: 'we-button',
          props: { bg: 'primary-400' },
          children: [{ type: 'we-icon', props: { name: 'users' } }, '4'],
        },
        // {
        //   type: 'CircleButton',
        //   props: {
        //     label: 'Home',
        //     image: 'https://avatars.githubusercontent.com/u/34165012?s=200&v=4',
        //     onClick: { $action: 'routeStore.navigate', args: ['/'] },
        //   },
        // },
        // {
        //   type: 'CircleButton',
        //   props: {
        //     label: 'Search',
        //     icon: 'magnifying-glass',
        //     onClick: { $action: 'routeStore.navigate', args: ['/search'] },
        //   },
        // },
        // {
        //   type: '$forEach',
        //   props: { items: { $store: 'adamStore.mySpaces' }, as: 'space' },
        //   children: [
        //     {
        //       type: 'CircleButton',
        //       props: {
        //         label: { $expr: 'space.name' },
        //         onClick: { $action: 'routeStore.navigate', args: [{ $expr: '`/space/${space.uuid}`' }] },
        //       },
        //     },
        //   ],
        // },
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
    { type: 'RerenderLog', props: { location: 'Template Sidebar' } },
  ],
};

// const templateHeader = {
//   type: 'Row',
//   props: { p: '400', gap: '400', ax: 'end', ay: 'center' },
//   children: [
//     { type: 'we-text', props: { fontSize: '600' }, children: ['Header!'] },
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
//     // {
//     //   type: 'PopoverMenu',
//     //   props: {
//     //     options: {
//     //       $map: {
//     //         items: { $store: 'templateStore.templates' },
//     //         select: { id: '$item.id', name: '$item.name', icon: '$item.icon' },
//     //       },
//     //     },
//     //     selectedOption: {
//     //       $pick: {
//     //         from: { $store: 'templateStore.currentTemplate' },
//     //         props: ['name', 'icon'],
//     //       },
//     //     },
//     //     onSelect: { $store: 'templateStore.setCurrentTemplate' },
//     //   },
//     // },
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
    { type: 'RerenderLog', props: { location: 'Template Modals' } },
  ],
};

const spacePageSidebar = {
  type: 'SpaceSidebarWidget',
  props: {
    name: { $store: 'spaceStore.space.name' },
    description: { $store: 'spaceStore.space.description' },
  },
  children: [{ type: 'RerenderLog', props: { location: 'SpacePage Sidebar' } }],
};

const spacePageHeader = {
  type: 'Row',
  props: { bg: 'ui-100', p: '400', gap: '400', ay: 'center' },
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
    { type: 'RerenderLog', props: { location: 'SpacePage Header' } },
  ],
};

// Full test template schema
export const testTemplateSchema: TemplateSchema = {
  meta: {
    name: 'Testing',
    description: 'A simple template used for testing',
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
      props: { class: 'we-default-template-content', ax: 'center', bg: 'ui-50' },
      children: [
        {
          type: 'main',
          props: { class: 'we-default-template-pages' },
          children: [testButtons, { type: '$routes' }],
        },
      ],
    },
    templateModals,
  ],
  routes: [
    {
      path: '*',
      type: 'Column',
      props: { ax: 'center', bg: 'ui-0', p: '500' },
      children: [{ type: 'we-text', props: { fontSize: '600' }, children: ['Page not found :_('] }],
    },
    {
      path: '/',
      type: 'Column',
      props: { ax: 'center', bg: 'ui-0', p: '500' },
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
          props: { class: 'we-space-page-content', bg: 'ui-50' },
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
          props: { bg: 'ui-200', ay: 'center', px: '400', style: { height: '60px' } },
          children: [
            { type: 'we-text', props: { fontSize: '600' }, children: ['About sub-page'] },
            { type: 'RerenderLog', props: { location: 'AboutPage' } },
          ],
        },
        {
          path: '/posts',
          children: [
            {
              type: 'Row',
              props: { bg: 'ui-200', ay: 'center', gap: '400', px: '400', style: { height: '60px' } },
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
                { type: 'RerenderLog', props: { location: 'PostsPage header buttons' } },
              ],
            },
            {
              type: 'Column',
              props: { bg: 'ui-300', p: '400' },
              children: [{ type: '$routes' }],
            },
            { type: 'RerenderLog', props: { location: 'PostsPage' } },
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
          props: { bg: 'ui-200', ay: 'center', px: '400', style: { height: '60px' } },
          children: [
            { type: 'we-text', props: { fontSize: '600' }, children: ['User sub-page'] },
            { type: 'RerenderLog', props: { location: 'UserPage' } },
          ],
        },
      ],
    },
  ],
};

// Update functions for testing different types of schema mutations
// Path reference for new inline structure:
//   children[0] = aside > children[0] = sidebar Column
//   children[1] = Column (content) > children[0] = main > children[0] = testButtons, children[1] = $routes
//   children[2] = modals fragment
//   routes[2] = space page Row > children[0] = aside > children[0] = sidebar
//   routes[2] > children[1] = Column > children[0] = header > children[0] = header Row
//   routes[2].routes[2] = /posts
export function testMutations(currentSchema: TemplateSchema, setCurrentSchema: SetStoreFunction<TemplateSchema>) {
  // Sidebar is now at children[0] (aside) > children[0] (Column)
  const sidebarPath = () => (deepClone(currentSchema) as any).children[0].children[0];

  function removeTemplateHeaderSlot() {
    // Header no longer exists as a slot — this mutation adds/removes a header element
    // inside the content Column (children[1])
    const newSchema = deepClone(currentSchema) as any;
    const contentColumn = newSchema.children[1];
    // Remove header if it exists (first child before main)
    if (contentColumn.children.length > 1 && contentColumn.children[0].type === 'header') {
      contentColumn.children.shift();
    }
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function addTemplateHeaderSlot() {
    const newSchema = deepClone(currentSchema) as any;
    const headerNode = {
      type: 'header',
      props: { class: 'we-default-template-header' },
      children: [
        {
          type: 'Row',
          props: { p: '400', gap: '400', ax: 'end', ay: 'center' },
          children: [
            { type: 'we-text', props: { fontSize: '600' }, children: ['Header!'] },
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
                options: {
                  $map: {
                    items: { $store: 'templateStore.templates' },
                    select: { id: '$item.id', name: '$item.name', icon: '$item.icon' },
                  },
                },
                selectedOption: {
                  $pick: {
                    from: { $store: 'templateStore.currentTemplate' },
                    props: ['name', 'icon'],
                  },
                },
                onSelect: { $store: 'templateStore.setCurrentTemplate' },
              },
            },
            { type: 'RerenderLog', props: { location: 'Template Header' } },
          ],
        },
      ],
    };
    // Insert header before main in the content Column
    const contentColumn = newSchema.children[1];
    contentColumn.children.unshift(headerNode);
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function changeTemplateHeaderProp() {
    const newSchema = deepClone(currentSchema) as any;
    // Header is first child of content Column > first child (Row)
    const contentColumn = newSchema.children[1];
    if (contentColumn.children[0]?.type === 'header') {
      contentColumn.children[0].children[0].props.bg = 'ui-900';
    }
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function changeTemplateHeaderChildProp() {
    const newSchema = deepClone(currentSchema) as any;
    const contentColumn = newSchema.children[1];
    if (contentColumn.children[0]?.type === 'header') {
      contentColumn.children[0].children[0].children[0].props.color = 'ui-900';
    }
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function changeSidebarProp() {
    const newSchema = deepClone(currentSchema) as any;
    // Sidebar Column is at children[0] (aside) > children[0]
    newSchema.children[0].children[0].props.bg = 'ui-900';
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function editSpacePageHeaderButton() {
    const newSchema = deepClone(currentSchema) as any;
    // Space page header Row: routes[2].children[1].children[0].children[0] (header > Row)
    newSchema.routes[2].children[1].children[0].children[0].children[1].props.variant = 'primary';
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function editPostsPageHeaderButton() {
    const newSchema = deepClone(currentSchema) as any;
    newSchema.routes[2].routes[2].children[0].children[2].props.variant = 'primary';
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function addPostsPageHeaderButton() {
    const newSchema = deepClone(currentSchema) as any;
    const newButton = { type: 'we-button', props: { variant: 'subtle', children: ['New button'] } };
    newSchema.routes[2].routes[2].children[0].children.push(newButton);
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function addSidebarButton() {
    const newSchema = deepClone(currentSchema) as any;
    const newButton = { type: 'we-button', props: { variant: 'subtle', children: ['New button'] } };
    // Sidebar Column > children[1] (bottom group)
    newSchema.children[0].children[0].children[1].children.push(newButton);
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function createInvalidSchema() {
    const newSchema = deepClone(currentSchema) as any;
    newSchema.children.push({ type: 5 });
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function changeNodeType() {
    const newSchema = deepClone(currentSchema) as any;
    // Change sidebar Column to Row
    newSchema.children[0].children[0].type = 'Row';
    newSchema.children[0].children[0].children[0].type = 'Row';
    newSchema.children[0].children[0].children[0].props = { gap: '800' };
    console.log('newSchema', newSchema);
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function addSidebarButton2() {
    const newSchema = deepClone(currentSchema) as any;
    const newButton = {
      type: 'we-button',
      props: { bg: 'primary-500' },
      children: [{ type: 'we-icon', props: { name: 'magnifying-glass' } }, '5'],
    };
    newSchema.children[0].children[0].children[0].children.unshift(newButton);
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  function addTwitterButton() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const newSchema = deepClone(currentSchema) as any;
    const newButton = {
      type: 'we-button',
      props: {
        pl: '300',
        pr: '600',
        gap: '400',
        r: 'pill',
        onClick: { $action: 'routeStore.navigate', args: ['/new'] },
        styles: { height: '50px' },
        hoverProps: { bg: 'ui-100', styles: { height: '100px' } },
      },
      children: [
        {
          type: 'we-icon',
          props: {
            name: 'x-logo',
            color: 'ui-1000',
            weight: {
              $if: {
                condition: { $eq: [{ $store: 'routeStore.currentPath' }, '/new'] },
                then: 'bold',
                else: 'regular',
              },
            },
          },
        },
        {
          type: 'we-text',
          props: {
            size: '600',
            color: 'ui-1000',
            weight: {
              $if: { condition: { $eq: [{ $store: 'routeStore.currentPath' }, '/new'] }, then: '600', else: '400' },
            },
          },
          children: ['New'],
        },
      ],
    };
    newSchema.children[0].children[0].children.splice(2, 0, newButton);
    updateSchema(currentSchema, newSchema, setCurrentSchema);
  }

  return {
    removeTemplateHeaderSlot,
    addTemplateHeaderSlot,
    changeTemplateHeaderProp,
    changeTemplateHeaderChildProp,
    changeSidebarProp,
    editSpacePageHeaderButton,
    editPostsPageHeaderButton,
    addPostsPageHeaderButton,
    addSidebarButton,
    createInvalidSchema,
    changeNodeType,
    addSidebarButton2,
    addTwitterButton,
  };
}
