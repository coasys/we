import type { TemplateSchema } from '@we/schema-renderer/shared';

export const aiSampleTemplateSchema: TemplateSchema = {
  meta: { name: 'Base', description: '', icon: '' },
  type: 'Row',
  children: [
    {
      type: 'Column',
      children: [
        {
          type: 'we-button',
          props: { onClick: { $action: 'routeStore.navigate', args: ['/'] }, hoverProps: { bg: 'ui-200' } },
          children: ['Home'],
        },
      ],
    },
    { type: 'Column', children: [{ type: '$routes' }] },
  ],
  routes: [{ path: '/', type: 'we-text', children: ['Home page'] }],
};

// Flex testing
// export const aiSampleTemplateSchema: TemplateSchema = {
//   meta: { name: 'Base', description: '', icon: '' },
//   type: 'Row',
//   props: { bg: 'ui-50', width: '100%', height: '100%' },
//   children: [
//     {
//       type: 'Row',
//       // props: { bg: 'ui-500', width: '100%' }, // button full height (normal width)
//       // props: { bg: 'ui-500', height: '100%' }, // button full height (normal width)
//       // type: 'Column',
//       // props: { bg: 'ui-500', width: '100%' }, // button full width (normal height)
//       // props: { bg: 'ui-500', height: '100%' }, // button normal width/height
//       children: [
//         {
//           type: 'we-button',
//           props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
//           children: ['Home'],
//         },
//       ],
//     },
//   ],
// };

// export const aiSampleTemplateSchema: TemplateSchema = {
//   meta: { name: 'Base', description: '', icon: '' },
//   type: 'Column',
//   props: { bg: 'ui-50', width: '100%', height: '100%' },
//   children: [
//     {
//       // type: 'Row',
//       // props: { bg: 'ui-500', width: '100%' }, // button normal width/height
//       // props: { bg: 'ui-500', height: '100%' }, // button full height (normal width)
//       type: 'Column',
//       // props: { bg: 'ui-500', width: '100%' }, // button full width (normal height)
//       props: { bg: 'ui-500', height: '100%' }, // button full width (normal height)
//       children: [
//         {
//           type: 'we-button',
//           props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
//           children: ['Home'],
//         },
//       ],
//     },
//   ],
// };
