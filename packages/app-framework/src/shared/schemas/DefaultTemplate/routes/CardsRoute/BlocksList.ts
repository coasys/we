import type { SchemaNode } from '@we/schema-shared';

import { cardShell, gridWrapper } from './CardShell.ts';

const blockSection = (
  contentType: string,
  model: string,
  header: SchemaNode[],
  body: SchemaNode[],
  maxHeight?: string | Record<string, unknown>,
): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $eq: [{ $local: 'contentType' }, contentType] },
    then: gridWrapper([
      {
        type: '$each',
        props: {
          items: { $query: { model, order: { createdAt: { $local: 'sortBy' } } } },
          as: 'block',
        },
        children: [cardShell({ header, body, maxHeight })],
      },
    ]),
  },
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const blockHeader = (icon: string, label: SchemaNode | string): SchemaNode[] => [
  {
    type: 'Row',
    props: { ay: 'center', gap: '200' },
    children: [
      { type: 'we-icon', props: { name: icon, color: 'neutral-500', size: 'sm' } },
      // typeof label === 'string'
      //   ? { type: 'we-text', props: { color: 'neutral-700', truncate: true }, children: [label] }
      //   : label,
    ],
  },
];

export const blocksList: SchemaNode = {
  type: 'Column',
  props: { gap: '0', width: '100%' },
  children: [
    blockSection(
      'text-blocks',
      'TextBlock',
      blockHeader('file-text', 'Text'),
      [{ type: 'we-text', children: ['$block.text'] }],
      {
        $if: {
          condition: { $eq: [{ $local: 'displayMode' }, 'grid'] },
          then: '200px',
          else: '50px',
        },
      },
    ),

    blockSection('image-blocks', 'ImageBlock', blockHeader('image', 'Image'), [
      {
        type: 'ImageDisplay',
        props: { src: '$block.src', altText: '$block.altText', width: '$block.width', height: '$block.height' },
      },
    ]),

    blockSection('audio-blocks', 'AudioBlock', blockHeader('music-notes', 'Audio'), [
      {
        type: 'AudioDisplay',
        props: {
          title: '$block.title',
          artist: '$block.artist',
          audioUrl: '$block.audioUrl',
          duration: '$block.duration',
          albumArt: '$block.albumArt',
        },
      },
    ]),

    blockSection('video-blocks', 'VideoBlock', blockHeader('video-camera', 'Video'), [
      {
        type: 'VideoDisplay',
        props: {
          url: '$block.url',
          title: '$block.title',
          thumbnail: '$block.thumbnail',
          provider: '$block.provider',
        },
      },
    ]),

    blockSection('file-blocks', 'FileBlock', blockHeader('file', 'File'), [
      {
        type: 'FileDisplay',
        props: {
          title: '$block.title',
          name: '$block.name',
          url: '$block.url',
          mimeType: '$block.mimeType',
          size: '$block.size',
        },
      },
    ]),

    blockSection('link-blocks', 'LinkBlock', blockHeader('link', 'Link'), [
      {
        type: 'LinkDisplay',
        props: {
          url: '$block.url',
          title: '$block.title',
          description: '$block.description',
          thumbnail: '$block.thumbnail',
        },
      },
    ]),

    blockSection('embed-blocks', 'EmbedBlock', blockHeader('browsers', 'Embed'), [
      {
        type: 'EmbedDisplay',
        props: {
          url: '$block.url',
          target: '$block.target',
          targetType: '$block.targetType',
          displayMode: '$block.displayMode',
        },
      },
    ]),

    blockSection('event-blocks', 'EventBlock', blockHeader('calendar', 'Event'), [
      {
        type: 'EventDisplay',
        props: {
          title: '$block.title',
          description: '$block.description',
          startDate: '$block.startDate',
          endDate: '$block.endDate',
          location: '$block.location',
          allDay: '$block.allDay',
        },
      },
    ]),

    blockSection('task-blocks', 'TaskBlock', blockHeader('check-square', 'Task'), [
      {
        type: 'TaskDisplay',
        props: {
          title: '$block.title',
          description: '$block.description',
          status: '$block.status',
          priority: '$block.priority',
          dueDate: '$block.dueDate',
          assignee: '$block.assignee',
        },
      },
    ]),

    blockSection('code-blocks', 'CodeBlock', blockHeader('code', 'Code'), [
      {
        type: 'CodeDisplay',
        props: { code: '$block.code', language: '$block.language', title: '$block.title' },
      },
    ]),

    blockSection('callout-blocks', 'CalloutBlock', blockHeader('megaphone', 'Callout'), [
      {
        type: 'CalloutDisplay',
        props: { text: '$block.text', variant: '$block.variant', icon: '$block.icon' },
      },
    ]),

    blockSection('location-blocks', 'LocationBlock', blockHeader('map-pin', 'Location'), [
      {
        type: 'LocationDisplay',
        props: {
          name: '$block.name',
          latitude: '$block.latitude',
          longitude: '$block.longitude',
          address: '$block.address',
        },
      },
    ]),

    blockSection('tag-blocks', 'TagBlock', blockHeader('tag', 'Tag'), [
      { type: 'TagDisplay', props: { name: '$block.name', color: '$block.color' } },
    ]),
  ],
};
