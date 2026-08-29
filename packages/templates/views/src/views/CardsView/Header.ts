import type { SchemaNode } from '@we/schema-shared';
import { expr } from '@we/schema-shared';

/**
 * Start a call, or go to the one you are in.
 *
 * ## It used to make the record itself
 *
 * The transcript's record was created by the first thing spoken, so a button that wanted a call to
 * be *set up ahead of time* had to write the `CollectionBlock` here and then pin this agent's
 * transcript to it with `resume`. That worked, and it needed a guard: pressing it mid-call created
 * an orphaned empty record and then no-opped the join it was created for.
 *
 * Both the create and the guard are gone. Starting a call creates its record — that is what a call's
 * identity now *is* — so this is one action, `startCall` handles the record, and transcribe adopts
 * it without being pinned. The mid-call branch stays, because the promise it makes is still worth
 * making: pressing this while in a call should take you to it, not start a second one behind it.
 * Starting a second is a real thing to want and it has its own control, in the join bar.
 */
const startCallButton: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'modules.call.canCall' },
    then: {
      type: 'we-button',
      props: {
        text: { $: "modules.call.active ? 'Go to call' : 'Call'" },
        variant: 'primary',
        /*
          A handler array so the branch is taken at click time. Written as a single `$action` with a
          `$if` in its args it would resolve when the header painted and freeze whichever answer was
          true then — the trap named in the schema docs, and the reason the two states are two
          entries rather than one conditional action.
        */
        onClick: [
          {
            $if: {
              condition: { $: 'modules.call.active' },
              then: { $action: 'modules.call.goToCall' },
            },
          },
          {
            $if: {
              condition: { $: '!modules.call.active' },
              then: { $action: 'modules.call.startCall' },
            },
          },
        ],
      },
    },
  },
};

/**
 * Show the calls nobody spoke in.
 *
 * A call's record exists from the moment the call starts, so opening one and closing it leaves an
 * empty card. Nothing deletes it — an agent on one side of a partition cannot tell "nobody spoke"
 * from "I cannot see what they said" — so the list folds those away and this is the way back to
 * them. Off by default: the common reason to look at this list is to find what was said.
 *
 * A `we-button` rather than a switch, and only on the calls tab: it is a filter on this one list,
 * and a switch in a header row reads as a setting for the whole view.
 */
const emptyCallsToggle: SchemaNode = {
  type: 'we-button',
  props: {
    variant: { $: "local.showEmptyCalls ? 'secondary' : 'ghost'" },
    size: 'sm',
    title: { $: "local.showEmptyCalls ? 'Hide calls nobody spoke in' : 'Show calls nobody spoke in'" },
    onClick: { $toggleLocal: 'showEmptyCalls' },
  },
  children: [{ type: 'we-icon', props: { name: 'eye-slash' } }],
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
    variant: expr`local.displayMode == ${mode} ? 'secondary' : 'ghost'`,
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
            value: { $: 'local.searchText' },
            onSearch: { $setLocal: 'searchText', value: { $: 'event' } },
          },
        },
        // Content type
        {
          type: 'Select',
          props: {
            // label: 'Type',
            value: { $: 'local.contentType' },
            options: contentTypeOptions,
            placeholder: 'All content',
            // Reset sortField on switch — a field like "likes" or "location" from the
            // previous content type won't be a valid option for the new one.
            onChange: [
              { $setLocal: 'contentType', value: { $: 'event' } },
              { $setLocal: 'sortField', value: 'date' },
            ],
          },
        },
        // Sort field (posts only — date vs. most liked)
        // Two $if-gated Select nodes rather than one Select with a conditional `options`, so each
        // keeps a static list and its own selection state.
        {
          type: '$if',
          props: {
            condition: { $: "local.contentType == 'posts'" },
            then: {
              type: 'Select',
              props: {
                label: 'Sort by',
                value: { $: 'local.sortField' },
                searchable: false,
                options: [
                  { label: 'Date', value: 'date', icon: 'calendar' },
                  { label: 'Likes', value: 'likes', icon: 'heart' },
                ],
                onChange: { $setLocal: 'sortField', value: { $: 'event' } },
              },
            },
          },
        },
        // Sort field (spaces only — date vs. location)
        {
          type: '$if',
          props: {
            condition: { $: "local.contentType == 'spaces'" },
            then: {
              type: 'Select',
              props: {
                label: 'Sort by',
                value: { $: 'local.sortField' },
                searchable: false,
                options: [
                  { label: 'Date', value: 'date', icon: 'calendar' },
                  { label: 'Location', value: 'location', icon: 'map-pin' },
                ],
                onChange: { $setLocal: 'sortField', value: { $: 'event' } },
              },
            },
          },
        },
        // Sort direction — applies to whichever field is selected above (date or likes)
        {
          type: 'Select',
          props: {
            label: 'Order',
            value: { $: 'local.sortDirection' },
            searchable: false,
            options: [
              { label: 'Desc', value: 'DESC', icon: 'sort-descending' },
              { label: 'Asc', value: 'ASC', icon: 'sort-ascending' },
            ],
            onChange: { $setLocal: 'sortDirection', value: { $: 'event' } },
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
        condition: { $: "local.contentType == 'calls'" },
        then: {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [emptyCallsToggle, startCallButton],
        },
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
