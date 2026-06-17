import type { SchemaNode } from '@we/schema-shared';

const contentTypeOptions = [
  { label: 'Posts', value: 'posts' },
  { label: 'Users', value: 'users' },
  { label: 'Spaces', value: 'spaces' },
  { label: 'Templates', value: 'templates' },
  { label: 'Text', value: 'text-blocks' },
  { label: 'Images', value: 'image-blocks' },
  { label: 'Audio', value: 'audio-blocks' },
  { label: 'Video', value: 'video-blocks' },
  { label: 'Files', value: 'file-blocks' },
  { label: 'Links', value: 'link-blocks' },
  { label: 'Embeds', value: 'embed-blocks' },
  { label: 'Events', value: 'event-blocks' },
  { label: 'Tasks', value: 'task-blocks' },
  { label: 'Code', value: 'code-blocks' },
  { label: 'Callouts', value: 'callout-blocks' },
  { label: 'Locations', value: 'location-blocks' },
  { label: 'Tags', value: 'tag-blocks' },
];

const displayModeButton = (mode: string, icon: string): SchemaNode => ({
  type: 'we-button',
  props: {
    variant: { $if: { condition: { $eq: [{ $local: 'displayMode' }, mode] }, then: 'secondary', else: 'ghost' } },
    square: true,
    onClick: { $setLocal: 'displayMode', value: mode },
  },
  children: [{ type: 'we-icon', props: { name: icon } }],
});

export const cardsHeader: SchemaNode = {
  type: 'Row',
  props: { ax: 'between', ay: 'center', gap: '300' },
  children: [
    // Left: filter controls
    {
      type: 'Row',
      props: { gap: '300', ay: 'center', wrap: true },
      children: [
        // Search
        {
          type: 'SearchInput',
          props: {
            placeholder: 'Search…',
            value: { $local: 'searchText' },
            onSearch: { $setLocal: 'searchText', from: '$event' },
          },
        },
        // Content type
        {
          type: 'we-select',
          props: {
            value: { $local: 'contentType' },
            searchable: true,
            options: contentTypeOptions,
            onChange: { $setLocal: 'contentType', from: '$event.target.value' },
            // width: '100px',
          },
        },
        // Sort order
        {
          type: 'we-select',
          props: {
            value: { $local: 'sortBy' },
            options: [
              { label: 'Newest', value: 'DESC' },
              { label: 'Oldest', value: 'ASC' },
            ],
            onChange: { $setLocal: 'sortBy', from: '$event.target.value' },
          },
        },
        // Display mode toggle
        {
          type: 'Row',
          props: { gap: '300' },
          children: [
            displayModeButton('expanded', 'list'),
            displayModeButton('compact', 'list-dashes'),
            displayModeButton('grid', 'squares-four'),
          ],
        },
      ],
    },
    // Right: create actions
    {
      type: 'Row',
      props: { gap: '300' },
      children: [
        {
          type: 'we-button',
          props: { text: 'Post', variant: 'primary', onClick: { $setLocal: 'createPostOpen', value: true } },
        },
        {
          type: 'we-button',
          props: { text: 'Space', variant: 'outline', onClick: { $setLocal: 'createSpaceModalOpen', value: true } },
        },
      ],
    },
  ],
};
