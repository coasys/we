import type { SchemaNode } from '@we/schema-shared';

const contentTypeOptions = [
  { label: 'Posts', value: 'posts', icon: 'newspaper' },
  { label: 'Users', value: 'users', icon: 'user' },
  { label: 'Spaces', value: 'spaces', icon: 'users-three' },
  { label: 'Templates', value: 'templates', icon: 'layout' },
  { label: 'Text', value: 'text-blocks', icon: 'text-aa', group: 'Blocks' },
  { label: 'Images', value: 'image-blocks', icon: 'image', group: 'Blocks' },
  { label: 'Audio', value: 'audio-blocks', icon: 'music-note', group: 'Blocks' },
  { label: 'Video', value: 'video-blocks', icon: 'video-camera', group: 'Blocks' },
  { label: 'Files', value: 'file-blocks', icon: 'file', group: 'Blocks' },
  { label: 'Links', value: 'link-blocks', icon: 'link', group: 'Blocks' },
  { label: 'Embeds', value: 'embed-blocks', icon: 'frame-corners', group: 'Blocks' },
  { label: 'Events', value: 'event-blocks', icon: 'calendar', group: 'Blocks' },
  { label: 'Tasks', value: 'task-blocks', icon: 'check-square', group: 'Blocks' },
  { label: 'Code', value: 'code-blocks', icon: 'code', group: 'Blocks' },
  { label: 'Callouts', value: 'callout-blocks', icon: 'megaphone', group: 'Blocks' },
  { label: 'Locations', value: 'location-blocks', icon: 'map-pin', group: 'Blocks' },
  { label: 'Tags', value: 'tag-blocks', icon: 'tag', group: 'Blocks' },
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
          type: 'GroupedSelect',
          props: {
            value: { $local: 'contentType' },
            options: contentTypeOptions,
            placeholder: 'All content',
            onChange: { $setLocal: 'contentType', from: '$event' },
          },
        },
        // Sort order
        {
          type: 'GroupedSelect',
          props: {
            value: { $local: 'sortBy' },
            searchable: false,
            options: [
              { label: 'Newest', value: 'DESC', icon: 'sort-descending' },
              { label: 'Oldest', value: 'ASC', icon: 'sort-ascending' },
            ],
            onChange: { $setLocal: 'sortBy', from: '$event' },
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
