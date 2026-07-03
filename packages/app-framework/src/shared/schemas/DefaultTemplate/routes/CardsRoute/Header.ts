import type { SchemaNode } from '@we/schema-shared';

const contentTypeOptions = [
  { label: 'Posts', value: 'posts', icon: 'newspaper' },
  { label: 'Users', value: 'users', icon: 'user' },
  { label: 'Spaces', value: 'spaces', icon: 'users-three' },
  { label: 'Templates', value: 'templates', icon: 'layout' },
  { label: 'Themes', value: 'themes', icon: 'paint-brush' },
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
          type: 'Search',
          props: {
            bg: 'neutral-0',
            border: '1px solid neutral-300',
            placeholder: 'Search…',
            value: { $local: 'searchText' },
            onSearch: { $setLocal: 'searchText', from: '$event' },
          },
        },
        // Content type
        {
          type: 'Select',
          props: {
            // label: 'Type',
            value: { $local: 'contentType' },
            options: contentTypeOptions,
            placeholder: 'All content',
            // Reset sortField on switch — a field like "likes" or "location" from the
            // previous content type won't be a valid option for the new one.
            onChange: [
              { $setLocal: 'contentType', from: '$event' },
              { $setLocal: 'sortField', value: 'date' },
            ],
          },
        },
        // Sort field (posts only — date vs. most liked)
        // Note: options must be a static array per branch — $if wraps array branch
        // values into an event-handler dispatcher (its `onClick: [...]` use case),
        // so a single Select with `options: { $if: {...} }` breaks Select's own
        // handling of the (now-function, not array) options prop. Two separate
        // $if-gated Select nodes sidestep that entirely.
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $local: 'contentType' }, 'posts'] },
            then: {
              type: 'Select',
              props: {
                label: 'Sort by',
                value: { $local: 'sortField' },
                searchable: false,
                options: [
                  { label: 'Date', value: 'date', icon: 'calendar' },
                  { label: 'Likes', value: 'likes', icon: 'heart' },
                ],
                onChange: { $setLocal: 'sortField', from: '$event' },
              },
            },
          },
        },
        // Sort field (spaces only — date vs. location)
        {
          type: '$if',
          props: {
            condition: { $eq: [{ $local: 'contentType' }, 'spaces'] },
            then: {
              type: 'Select',
              props: {
                label: 'Sort by',
                value: { $local: 'sortField' },
                searchable: false,
                options: [
                  { label: 'Date', value: 'date', icon: 'calendar' },
                  { label: 'Location', value: 'location', icon: 'map-pin' },
                ],
                onChange: { $setLocal: 'sortField', from: '$event' },
              },
            },
          },
        },
        // Sort direction — applies to whichever field is selected above (date or likes)
        {
          type: 'Select',
          props: {
            label: 'Order',
            value: { $local: 'sortDirection' },
            searchable: false,
            options: [
              { label: 'Desc', value: 'DESC', icon: 'sort-descending' },
              { label: 'Asc', value: 'ASC', icon: 'sort-ascending' },
            ],
            onChange: { $setLocal: 'sortDirection', from: '$event' },
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
