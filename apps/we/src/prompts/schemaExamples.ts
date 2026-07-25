import { AIPromptExamples } from '@coasys/ad4m';
import type { PatchOp } from '@we/schema-renderer/shared';
import { TemplateSchema } from '@we/schema-renderer/shared';

interface SchemaPromptExample {
  request: string;
  currentSchema: object;
  response: string;
  patches: PatchOp[];
}

const baseExample: TemplateSchema = {
  meta: { name: 'Base', description: '', icon: '' },
  type: 'Row',
  children: [
    {
      type: 'Column',
      children: [
        {
          type: 'we-button',
          props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
          children: ['Home'],
        },
      ],
    },
    { type: 'Column', children: [{ type: '$routes' }] },
  ],
  routes: [{ path: '/', type: 'we-text', children: ['Home page'] }],
};

const invalidRequest: SchemaPromptExample = {
  request: 'asdfjasdf jasdfjhasdf rras',
  currentSchema: {},
  response: "Sorry, I couldn't understand your prompt. Please try rephrasing it.",
  patches: [],
};

const addButton: SchemaPromptExample = {
  request: 'Add a button that navigates to the /explore route with the label Explore',
  currentSchema: baseExample,
  response: "I've added a new button to navigate to the /explore route with the label Explore.",
  patches: [
    {
      op: 'add',
      path: '/children/0/children/-',
      value: {
        type: 'we-button',
        props: { onClick: { $action: 'routeStore.navigate', args: ['/explore'] } },
        children: ['Explore'],
      },
    },
    {
      op: 'add',
      path: '/routes/-',
      value: { path: '/explore', type: 'we-text', children: ['Explore page'] },
    },
  ],
};

const deleteButton: SchemaPromptExample = {
  request: 'Remove the Home button from the template',
  currentSchema: {
    meta: { name: 'Base', description: '', icon: '' },
    type: 'Row',
    children: [
      {
        type: 'Column',
        children: [
          {
            type: 'we-button',
            props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
            children: ['Home'],
          },
          {
            type: 'we-button',
            props: { onClick: { $action: 'routeStore.navigate', args: ['/explore'] } },
            children: ['Explore'],
          },
        ],
      },
      { type: 'Column', children: [{ type: '$routes' }] },
    ],
    routes: [
      { path: '/', type: 'we-text', children: ['Home page'] },
      { path: '/explore', type: 'we-text', children: ['Explore page'] },
    ],
  },
  response: "I've removed the Home button from the template.",
  patches: [{ op: 'remove', path: '/children/0/children/0' }],
};

const renameButton: SchemaPromptExample = {
  request: 'Rename the home button to Dashboard',
  currentSchema: baseExample,
  response: "I've renamed the home button to Dashboard.",
  patches: [
    { op: 'replace', path: '/children/0/children/0/children/0', value: 'Dashboard' },
    { op: 'replace', path: '/routes/0/children/0', value: 'Dashboard page' },
  ],
};

const changeButtonStyle: SchemaPromptExample = {
  request: 'Give the buttons a blue background and rounded corners',
  currentSchema: baseExample,
  response: "I've updated the buttons to have a blue background and rounded corners.",
  patches: [
    { op: 'add', path: '/children/0/children/0/props/bg', value: '#4fd0ff' },
    { op: 'add', path: '/children/0/children/0/props/r', value: 'pill' },
  ],
};

const repositionSidebar: SchemaPromptExample = {
  request: 'Move the sidebar to the right side of the layout',
  currentSchema: baseExample,
  response: "I've moved the sidebar to the right side of the layout.",
  patches: [{ op: 'move', from: '/children/0', path: '/children/1' }],
};

const addHeader: SchemaPromptExample = {
  request: 'Add a header at the top of the layout with the text Welcome to the App',
  currentSchema: baseExample,
  response: "I've added a header to the layout.",
  patches: [
    {
      op: 'add',
      path: '/children/1/children/0',
      value: { type: 'we-text', props: { size: '700', weight: '600' }, children: ['Welcome to the App'] },
    },
  ],
};

const addDummyPostsToHomepage: SchemaPromptExample = {
  request: 'Add some dummy posts to the homepage',
  currentSchema: baseExample,
  response: "I've added some dummy posts to the homepage.",
  patches: [
    {
      op: 'replace',
      path: '/routes/0',
      value: {
        path: '/',
        type: 'Column',
        props: { gap: '400' },
        children: [
          { type: 'we-text', children: ['Home page'] },
          { type: 'PostCard', props: { title: 'First Post', text: 'This is a dummy post.' } },
          { type: 'PostCard', props: { title: 'Second Post', text: 'Another example post.' } },
          { type: 'PostCard', props: { title: 'Third Post', text: 'Yet another dummy post.' } },
        ],
      },
    },
  ],
};

const mapStoreArray: SchemaPromptExample = {
  request: 'Display a list of my spaces in the sidebar',
  currentSchema: baseExample,
  response: "I've added a list of your spaces to the sidebar.",
  patches: [
    {
      op: 'add',
      path: '/children/0/children/-',
      value: {
        type: '$forEach',
        props: { items: { $store: 'adamStore.mySpaces' }, as: 'space' },
        children: [{ type: 'we-text', props: { text: { $expr: 'space.name' } } }],
      },
    },
  ],
};

const conditionalProp: SchemaPromptExample = {
  request: 'Highlight the home button if we are on the home route',
  currentSchema: baseExample,
  response: "I've updated the home button to be highlighted when on the home route.",
  patches: [
    {
      op: 'add',
      path: '/children/0/children/0/props/bg',
      value: {
        $if: {
          condition: { $eq: [{ $store: 'routeStore.currentPath' }, '/'] },
          then: 'primary-200',
        },
      },
    },
  ],
};

const conditionalNode: SchemaPromptExample = {
  request: 'Only show the home button when we are not on the home page',
  currentSchema: baseExample,
  response: "I've updated the schema to only show the home button when we are not on the home page.",
  patches: [
    {
      op: 'replace',
      path: '/children/0/children/0',
      value: {
        type: '$if',
        props: {
          condition: { $ne: [{ $store: 'routeStore.currentPath' }, '/'] },
          then: {
            type: 'we-button',
            props: { onClick: { $action: 'routeStore.navigate', args: ['/'] } },
            children: ['Home'],
          },
        },
      },
    },
  ],
};

const examples: SchemaPromptExample[] = [
  invalidRequest,
  addButton,
  deleteButton,
  renameButton,
  changeButtonStyle,
  repositionSidebar,
  addHeader,
  addDummyPostsToHomepage,
  mapStoreArray,
  conditionalProp,
  conditionalNode,
];

export const schemaPromptExamples: AIPromptExamples[] = examples.map((example) => ({
  input: JSON.stringify({ request: example.request, currentSchema: example.currentSchema }),
  output: JSON.stringify({ response: example.response, patches: example.patches }),
}));
