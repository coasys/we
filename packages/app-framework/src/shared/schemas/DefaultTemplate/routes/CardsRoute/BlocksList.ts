import type { SchemaNode } from '@we/schema-shared';

const blockCard = (children: SchemaNode[]): SchemaNode => ({
  type: 'Column',
  props: { bg: 'neutral-100', r: '400', border: '1px solid neutral-200', p: '400', gap: '300' },
  children,
});

const blockSection = (contentType: string, model: string, items: SchemaNode[]): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $eq: [{ $local: 'contentType' }, contentType] },
    then: {
      type: '$each',
      props: {
        items: { $query: { model, order: { createdAt: { $local: 'sortBy' } } } },
        as: 'block',
      },
      children: [blockCard(items)],
    },
  },
});

export const blocksList: SchemaNode = {
  type: 'Column',
  props: { gap: '400' },
  children: [
    blockSection('text-blocks', 'TextBlock', [
      { type: 'we-text', props: { color: 'neutral-800' }, children: ['$block.text'] },
    ]),

    blockSection('image-blocks', 'ImageBlock', [
      {
        type: 'we-image',
        props: { src: '$block.src', alt: '$block.altText', fit: 'contain', width: '100%' },
      },
    ]),

    blockSection('audio-blocks', 'AudioBlock', [
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

    blockSection('video-blocks', 'VideoBlock', [
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

    blockSection('file-blocks', 'FileBlock', [
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

    blockSection('link-blocks', 'LinkBlock', [
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

    blockSection('embed-blocks', 'EmbedBlock', [
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

    blockSection('event-blocks', 'EventBlock', [
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

    blockSection('task-blocks', 'TaskBlock', [
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

    blockSection('code-blocks', 'CodeBlock', [
      {
        type: 'CodeDisplay',
        props: { code: '$block.code', language: '$block.language', title: '$block.title' },
      },
    ]),

    blockSection('callout-blocks', 'CalloutBlock', [
      {
        type: 'CalloutDisplay',
        props: { text: '$block.text', variant: '$block.variant', icon: '$block.icon' },
      },
    ]),

    blockSection('location-blocks', 'LocationBlock', [
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

    blockSection('tag-blocks', 'TagBlock', [
      { type: 'TagDisplay', props: { name: '$block.name', color: '$block.color' } },
    ]),
  ],
};
