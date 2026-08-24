import type { SchemaNode } from '@we/schema-shared';

/**
 * Start a call, and put its record on the list before a word is said.
 *
 * The transcript's record is normally created by the first thing spoken, so that a call nobody
 * recorded leaves no trace. That rule is about calls nobody *asked* for. Asking for one here is a
 * deliberate act, so the record is created up front and this agent's transcript pinned to it — which
 * is also what makes the call resumable, since a record is reachable afterwards only if it exists.
 *
 * It does mean a call created and never spoken in stays on the list as an empty card. That is the
 * cost of being able to set one up ahead of time, and it is deletable like any other.
 *
 * `resume` rather than a second create: pinning is the same operation Continue performs, and going
 * through it means the peers who join adopt this record instead of making their own.
 */
const startCallButton: SchemaNode = {
  type: '$if',
  props: {
    condition: { $store: 'modules.call.canCall' },
    then: {
      type: 'we-button',
      props: {
        text: 'Call',
        variant: 'primary',
        onClick: {
          $action: 'model.create',
          args: ['CollectionBlock', { kind: 'call', type: 'collection' }],
          onSuccess: [
            { $action: 'modules.call.joinSpaceCall' },
            { $action: 'modules.transcribe.resume', args: ['$result.id'] },
          ],
        },
      },
    },
  },
};

const contentTypeOptions = [
  { label: 'Posts', value: 'posts', icon: 'newspaper' },
  { label: 'Calls', value: 'calls', icon: 'phone' },
  { label: 'Users', value: 'users', icon: 'user' },
  { label: 'Spaces', value: 'spaces', icon: 'users-three' },
  { label: 'Templates', value: 'templates', icon: 'layout' },
  { label: 'Themes', value: 'themes', icon: 'paint-brush' },
  { label: 'Channels', value: 'flux-channels', icon: 'hash', group: 'Flux' },
  { label: 'Conversations', value: 'flux-conversations', icon: 'chats-circle', group: 'Flux' },
  { label: 'Conversations (Nested)', value: 'flux-conversations-nested', icon: 'tree-structure', group: 'Flux' },
  { label: 'Conversation Subgroups', value: 'flux-conversation-subgroups', icon: 'chat-dots', group: 'Flux' },
  { label: 'Messages', value: 'flux-messages', icon: 'envelope-simple', group: 'Flux' },
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
        // Search. States no fill or outline of its own. The `Select`s beside it are outline buttons
        // on `surface-sunken`, and `we-input` now defaults to the same, so the row agrees without
        // being told to. This used to ask for `border-strong` — the *emphasised* role, against its
        // neighbours' ordinary `border` — which is what made this one control read as brighter.
        {
          type: 'Search',
          props: {
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
    /*
      Right: create actions, for whatever is being listed.

      The calls tab swaps them rather than adding to them. A row of "Post · Space · Call" makes the
      create action a menu you have to read, and two of the three are inert on a list of calls — the
      button that matters is the one for the thing in front of you.
    */
    {
      type: '$if',
      props: {
        condition: { $eq: [{ $local: 'contentType' }, 'calls'] },
        then: startCallButton,
        else: {
          type: 'Row',
          props: { gap: '300' },
          children: [
            {
              type: 'we-button',
              props: { text: 'Post', variant: 'primary', onClick: { $setLocal: 'createPostOpen', value: true } },
            },
            {
              type: 'we-button',
              props: {
                text: 'Space',
                variant: 'outline',
                // Opens the shell-chrome mount (slot 'core:createSpace'), which exists once and
                // closes itself via the same shell flag. A route-local copy of the modal used to
                // live here, gated on a local flag its close never cleared — unclosable.
                onClick: { $action: 'shellStore.setCreateSpaceOpen', args: [true] },
              },
            },
          ],
        },
      },
    },
  ],
};
