/**
 * Settings → Devices: the two halves of the hosting index.
 *
 * **Find a host** — the list a person reads before adding a cloud device: Coasys cloud first, then
 * "Another host", the hosts the index lists, then "Add by its address", an address typed in. The index
 * is a convenience and never the only way to a host, so the address field stays when the index does
 * not answer.
 * Choosing an entry calls `hostingStore.choose` (or `chooseAddress`), which records it in
 * `hostingStore.chosen` and starts "Add a cloud device" with that host (`deviceStore.addCloudDevice`).
 * This is the one place an address is typed; the Add a cloud device card has none.
 *
 * **Earn with it** — for an operator's device: the text of its listing, List, Withdraw, and what the
 * index says about it now (listed, can't be reached, removed and why).
 *
 * Every word comes worded from `hostingStore`, so these nodes only arrange. Nothing here is offered
 * to a space template: `hostingStore` is chrome only.
 */
import type { SchemaNode } from '@we/schema-shared';

const card = (children: SchemaNode[]): SchemaNode => ({
  type: 'Column',
  props: { gap: '300', p: '400', bg: 'surface', r: 'surface', border: '1px solid border' },
  children,
});

const title = (text: string, blurb: string): SchemaNode => ({
  type: 'Column',
  props: { gap: '100' },
  children: [
    { type: 'we-text', props: { variant: 'heading-sm', tag: 'h2' }, children: [text] },
    { type: 'we-text', props: { variant: 'body', color: 'text-muted' }, children: [blurb] },
  ],
});

const muted = (children: SchemaNode['children']): SchemaNode => ({
  type: 'we-text',
  props: { variant: 'footnote', color: 'text-muted' },
  children,
});

const alert = (condition: string, tone: string, text: string): SchemaNode => ({
  type: '$if',
  props: { condition: { $: condition }, then: { type: 'we-alert', props: { tone }, children: [{ $: text }] } },
});

// ─── Find a host ────────────────────────────────────────────────────────────────

const hostRow: SchemaNode = {
  type: 'Column',
  props: { gap: '200', p: '300', bg: 'surface', r: 'control', border: '1px solid border' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', ax: 'between', wrap: true },
      children: [
        {
          type: 'Row',
          props: { gap: '200', ay: 'center' },
          children: [
            { type: 'we-text', props: { fontWeight: 'semibold' }, children: [{ $: 'host.name' }] },
            {
              type: '$if',
              props: {
                condition: { $: 'host.runByCoasys' },
                then: { type: 'we-badge', props: { tone: 'accent' }, children: ['Run by Coasys'] },
              },
            },
          ],
        },
        {
          type: 'we-button',
          props: {
            variant: 'soft',
            size: 'sm',
            disabled: { $: '!host.joinable || !deviceStore.canAddCloudDevice' },
            onClick: { $invoke: 'hostingStore.choose', args: [{ $: 'host.id' }] },
          },
          children: ['Choose'],
        },
      ],
    },
    {
      type: '$if',
      props: { condition: { $: "host.details != ''" }, then: muted([{ $: 'host.details' }]) },
    },
    muted([{ $: 'host.signup' }]),
    { type: '$if', props: { condition: { $: "host.charge != ''" }, then: muted([{ $: 'host.charge' }]) } },
    {
      type: '$if',
      props: { condition: { $: "host.models != ''" }, then: muted([{ $: '`Runs ${host.models}`' }]) },
    },
    muted([{ $: 'host.address' }]),
  ],
};

const anotherHost: SchemaNode = card([
  { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Add by its address'] },
  muted(['Enter the address of a host you know, like riverbank.example.']),
  {
    type: 'we-input',
    props: {
      label: 'Address',
      placeholder: 'riverbank.example',
      value: { $: 'hostingStore.address' },
      onInput: { $invoke: 'hostingStore.setAddress', args: [{ $: 'event.detail' }] },
    },
  },
  alert("hostingStore.addressProblem != ''", 'warning', 'hostingStore.addressProblem'),
  {
    type: 'Row',
    props: { ax: 'end' },
    children: [
      {
        type: 'we-button',
        props: {
          variant: 'soft',
          size: 'sm',
          disabled: {
            $: "hostingStore.address == '' || hostingStore.addressProblem != '' || !deviceStore.canAddCloudDevice",
          },
          onClick: { $invoke: 'hostingStore.chooseAddress' },
        },
        children: ['Choose this host'],
      },
    ],
  },
]);

const chosenCard: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'hostingStore.chosen' },
    then: card([
      { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Host chosen'] },
      {
        type: 'we-text',
        props: { fontFamily: 'mono', variant: 'footnote' },
        children: [
          { $: "hostingStore.chosen.kind == 'listed' ? hostingStore.chosen.host.url : hostingStore.chosen.url" },
        ],
      },
      {
        type: 'Row',
        props: { ax: 'end' },
        children: [
          {
            type: 'we-button',
            props: { variant: 'ghost', size: 'sm', onClick: { $invoke: 'hostingStore.clearChoice' } },
            children: ['Choose another'],
          },
        ],
      },
    ]),
  },
};

/** The list of hosts, read when the person asks for it: reading it reaches the network. */
export const findHostSection: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    title('Find a host', 'Coasys cloud, another host from the hosting index, or a host you add by its address.'),
    { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Another host'] },
    {
      type: '$if',
      props: {
        condition: { $: "hostingStore.hostListState == 'unconfigured'" },
        then: muted(['This app is not set up to read the hosting index. "Add by its address" still works.']),
        else: {
          type: 'Column',
          props: { gap: '300' },
          children: [
            {
              type: 'Row',
              props: { gap: '200', ay: 'center' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    variant: 'soft',
                    size: 'sm',
                    loading: { $: "hostingStore.hostListState == 'loading'" },
                    onClick: { $invoke: 'hostingStore.loadHosts' },
                  },
                  children: [
                    {
                      $: "hostingStore.hostListState == 'idle' ? 'Show hosts' : 'Refresh the list'",
                    },
                  ],
                },
              ],
            },
            {
              type: '$if',
              props: {
                condition: { $: "hostingStore.hostListState == 'down'" },
                then: {
                  type: 'we-alert',
                  props: { tone: 'warning' },
                  children: [
                    { $: 'hostingStore.hostListError' },
                    {
                      type: 'we-button',
                      props: { variant: 'ghost', size: 'sm', onClick: { $invoke: 'hostingStore.loadHosts' } },
                      children: ['Try again'],
                    },
                  ],
                },
              },
            },
            {
              type: '$if',
              props: {
                condition: { $: "hostingStore.hostListState == 'ready' && hostingStore.hosts.length == 0" },
                then: muted(['The hosting index lists no hosts yet.']),
              },
            },
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                { type: '$each', props: { items: { $: 'hostingStore.hosts' }, as: 'host' }, children: [hostRow] },
              ],
            },
          ],
        },
      },
    },
    anotherHost,
    chosenCard,
  ],
};

// ─── Earn with it ───────────────────────────────────────────────────────────────

const field = (label: string, name: string, placeholder: string, multiline = false): SchemaNode => ({
  type: multiline ? 'we-textarea' : 'we-input',
  props: {
    label,
    placeholder,
    ...(multiline ? { rows: 3 } : {}),
    value: { $: `hostingStore.draft.${name}` },
    onInput: { $invoke: 'hostingStore.setDraftField', args: [name, { $: 'event.detail' }] },
  },
});

const listingState: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'hostingStore.listing' },
    then: card([
      {
        type: 'Row',
        props: { gap: '200', ay: 'center', wrap: true },
        children: [
          { type: 'we-text', props: { fontWeight: 'semibold' }, children: [{ $: 'hostingStore.listing.name' }] },
          {
            type: 'we-badge',
            props: { tone: { $: 'hostingStore.listing.tone' } },
            children: [{ $: 'hostingStore.listing.label' }],
          },
        ],
      },
      muted([{ $: 'hostingStore.listing.line' }]),
      {
        type: '$if',
        props: {
          condition: { $: "hostingStore.listing.models != ''" },
          then: muted([{ $: '`Runs ${hostingStore.listing.models}`' }]),
        },
      },
      {
        type: '$each',
        props: { items: { $: 'hostingStore.listing.rates' }, as: 'rate' },
        children: [muted([{ $: 'rate' }])],
      },
      {
        type: '$if',
        props: {
          condition: { $: '!hostingStore.listing.confirmed' },
          then: muted(['Shown from what this device remembers. The index has not confirmed it.']),
        },
      },
    ]),
  },
};

/** Whether this device is on the hosting index, and the words to put it there. */
export const earnWithItSection: SchemaNode = {
  type: '$if',
  props: {
    condition: { $: 'hostingStore.available' },
    then: {
      type: 'Column',
      props: { gap: '300' },
      children: [
        title(
          'Earn with it',
          'List this device on the hosting index so people can find it and add it as a cloud device.',
        ),
        alert(
          "hostingStore.indexError != ''",
          'warning',
          '`The hosting index does not answer. ${hostingStore.indexError}`',
        ),
        {
          type: '$if',
          props: {
            condition: { $: 'hostingStore.noOperator' },
            then: muted(['This identity cannot offer devices yet.']),
            else: {
              type: '$if',
              props: {
                condition: { $: 'hostingStore.notAllowed' },
                then: muted(['This identity cannot offer devices yet. The hosting index does not list it.']),
                else: {
                  type: 'Column',
                  props: { gap: '300' },
                  children: [
                    listingState,
                    field('Name', 'name', 'Riverbank'),
                    field('Where', 'location', 'Lyon'),
                    field('Address', 'url', 'riverbank.example'),
                    field('Listing text', 'description', 'Who it is for and what it offers', true),
                    alert(
                      "hostingStore.problem != '' && hostingStore.draft.name != ''",
                      'warning',
                      'hostingStore.problem',
                    ),
                    alert("hostingStore.error != ''", 'danger', 'hostingStore.error'),
                    {
                      type: 'Row',
                      props: { gap: '200', ax: 'end' },
                      children: [
                        {
                          type: '$if',
                          props: {
                            condition: { $: 'hostingStore.isListed' },
                            then: {
                              type: 'we-button',
                              props: {
                                variant: 'ghost',
                                size: 'sm',
                                loading: { $: 'hostingStore.withdrawing' },
                                onClick: { $invoke: 'hostingStore.withdraw' },
                              },
                              children: ['Withdraw'],
                            },
                          },
                        },
                        {
                          type: 'we-button',
                          props: {
                            variant: 'solid',
                            size: 'sm',
                            disabled: { $: "hostingStore.problem != ''" },
                            loading: { $: 'hostingStore.publishing' },
                            onClick: { $invoke: 'hostingStore.publish' },
                          },
                          children: [{ $: "hostingStore.isListed ? 'Update the listing' : 'List'" }],
                        },
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      ],
    },
  },
};
