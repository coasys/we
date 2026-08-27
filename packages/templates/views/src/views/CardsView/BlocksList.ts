import type { SchemaNode } from '@we/schema-shared';
import { cardList, cardShell, emptyState } from '@we/template-kit';

interface BlockSectionOptions {
  /** The `contentType` value this section is selected by, from the header's type picker. */
  contentType: string;
  entity: string;
  /** The type's icon — used in the card header and, when there are no cards, in the placeholder. */
  icon: string;
  /** Plural noun for the placeholder sentence: `image blocks`, `tasks`. */
  label: string;
  body: SchemaNode[];
  maxHeight?: string | Record<string, unknown>;
}

/**
 * One block type's section. Every one of the thirteen is the same list of the same shape over a
 * different entity, so they are generated rather than written out — which is also why the
 * placeholder only had to be added once.
 *
 * The section's query lives inside the `$if`, so only the selected type is ever subscribed to.
 */
const blockSection = (opts: BlockSectionOptions): SchemaNode => ({
  type: '$if',
  props: {
    condition: { $eq: [{ $local: 'contentType' }, opts.contentType] },
    then: cardList({
      query: { entity: opts.entity, order: { createdAt: { $local: 'sortDirection' } } },
      as: 'block',
      // Not search-aware: these sections don't filter on `searchText`, so nothing here can be
      // hidden by the search box.
      empty: emptyState({ icon: opts.icon, label: opts.label }),
      children: [cardShell({ header: blockHeader(opts.icon), body: opts.body, maxHeight: opts.maxHeight })],
    }),
  },
});

const blockHeader = (icon: string): SchemaNode[] => [
  {
    type: 'Row',
    props: { ay: 'center', gap: '200' },
    children: [
      { type: 'we-icon', props: { name: icon, size: 'sm' } },
      // The type's name used to sit beside the icon, and is left commented out here as before:
      // { type: 'we-text', props: { color: 'text', truncate: true }, children: ['<type name>'] },
    ],
  },
];

export const blocksList: SchemaNode = {
  type: 'Column',
  props: { gap: '0', width: '100%' },
  children: [
    blockSection({
      contentType: 'text-blocks',
      entity: 'TextBlock',
      icon: 'file-text',
      label: 'text blocks',
      body: [{ type: 'we-text', children: ['$block.text'] }],
      maxHeight: { $: "local.displayMode == 'grid' ? '200px' : '50px'" },
    }),

    blockSection({
      contentType: 'image-blocks',
      entity: 'ImageBlock',
      icon: 'image',
      label: 'image blocks',
      body: [
        {
          type: 'ImageDisplay',
          props: { src: '$block.src', altText: '$block.altText', width: '$block.width', height: '$block.height' },
        },
      ],
    }),

    blockSection({
      contentType: 'audio-blocks',
      entity: 'AudioBlock',
      icon: 'music-notes',
      label: 'audio blocks',
      body: [
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
      ],
    }),

    blockSection({
      contentType: 'video-blocks',
      entity: 'VideoBlock',
      icon: 'video-camera',
      label: 'video blocks',
      body: [
        {
          type: 'VideoDisplay',
          props: {
            url: '$block.url',
            title: '$block.title',
            thumbnail: '$block.thumbnail',
            provider: '$block.provider',
          },
        },
      ],
    }),

    blockSection({
      contentType: 'file-blocks',
      entity: 'FileBlock',
      icon: 'file',
      label: 'file blocks',
      body: [
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
      ],
    }),

    blockSection({
      contentType: 'link-blocks',
      entity: 'LinkBlock',
      icon: 'link',
      label: 'link blocks',
      body: [
        {
          type: 'LinkDisplay',
          props: {
            url: '$block.url',
            title: '$block.title',
            description: '$block.description',
            thumbnail: '$block.thumbnail',
          },
        },
      ],
    }),

    blockSection({
      contentType: 'embed-blocks',
      entity: 'EmbedBlock',
      icon: 'browsers',
      label: 'embed blocks',
      body: [
        {
          type: 'EmbedDisplay',
          props: {
            url: '$block.url',
            target: '$block.target',
            targetType: '$block.targetType',
            displayMode: '$block.displayMode',
          },
        },
      ],
    }),

    blockSection({
      contentType: 'event-blocks',
      entity: 'EventBlock',
      icon: 'calendar',
      label: 'event blocks',
      body: [
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
      ],
    }),

    blockSection({
      contentType: 'task-blocks',
      entity: 'TaskBlock',
      icon: 'check-square',
      label: 'task blocks',
      body: [
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
      ],
    }),

    blockSection({
      contentType: 'code-blocks',
      entity: 'CodeBlock',
      icon: 'code',
      label: 'code blocks',
      body: [
        {
          type: 'CodeDisplay',
          props: { code: '$block.code', language: '$block.language', title: '$block.title' },
        },
      ],
    }),

    blockSection({
      contentType: 'callout-blocks',
      entity: 'CalloutBlock',
      icon: 'megaphone',
      label: 'callout blocks',
      body: [
        {
          type: 'CalloutDisplay',
          props: { text: '$block.text', variant: '$block.variant', icon: '$block.icon' },
        },
      ],
    }),

    blockSection({
      contentType: 'location-blocks',
      entity: 'LocationBlock',
      icon: 'map-pin',
      label: 'location blocks',
      body: [
        {
          type: 'LocationDisplay',
          props: {
            name: '$block.name',
            latitude: '$block.latitude',
            longitude: '$block.longitude',
            address: '$block.address',
          },
        },
      ],
    }),

    blockSection({
      contentType: 'tag-blocks',
      entity: 'TagBlock',
      icon: 'tag',
      label: 'tag blocks',
      body: [{ type: 'TagDisplay', props: { name: '$block.name', color: '$block.color' } }],
    }),
  ],
};
