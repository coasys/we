/**
 * Every place a theme reaches, on one page — for looking at a theme rather than at a space.
 *
 * Somebody editing a theme needs to see what it does to things their own space may not have on
 * screen: a danger button, a teal badge, a toned card, a disabled field, a glow, the ten palette
 * hues, a heat map in a dark theme. Switching to this template while the theme panel is open shows
 * all of them at once, and switching back loses nothing, since it reads no data.
 *
 * It holds no records and asks for no stores beyond the theme's own state, so it renders the same in
 * any space. Each section is one question a theme answers, in the order the theme panel asks them.
 */
import type { SchemaNode } from '@we/schema-shared';

const TONES = [
  'neutral',
  'accent',
  'success',
  'warning',
  'danger',
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'teal',
  'cyan',
  'blue',
  'purple',
  'pink',
];
const PALETTE = TONES.slice(5);
const STATUSES = ['accent', 'success', 'warning', 'danger'];

const heading = (text: string, hint: string): SchemaNode => ({
  type: 'Column',
  props: { gap: '100' },
  children: [
    { type: 'we-text', props: { variant: 'overline', color: 'text-muted' }, children: [hint] },
    { type: 'we-text', props: { variant: 'heading-md', tag: 'h2' }, children: [text] },
  ],
});

const section = (title: string, hint: string, ...children: SchemaNode[]): SchemaNode => ({
  type: 'Column',
  props: { gap: '400', p: 'surface', bg: 'surface', r: 'surface', border: '1px solid border' },
  children: [heading(title, hint), ...children],
});

/** One row per tone: every button variant, then badges and tags in both of theirs. */
const toneRow: SchemaNode = {
  type: '$each',
  props: { items: TONES, as: 'tone' },
  children: [
    {
      type: 'Row',
      props: { gap: '200', ay: 'center', wrap: true },
      children: [
        {
          type: 'we-text',
          props: { variant: 'label', color: 'text-muted', minWidth: '72px' },
          children: [{ $: 'tone' }],
        },
        ...['solid', 'soft', 'outline', 'ghost'].map((variant): SchemaNode => ({
          type: 'we-button',
          props: { size: 'sm', variant, tone: { $: 'tone' } },
          children: [variant],
        })),
        { type: 'we-badge', props: { tone: { $: 'tone' } }, children: ['soft'] },
        { type: 'we-badge', props: { variant: 'solid', tone: { $: 'tone' } }, children: ['solid'] },
        { type: 'we-tag', props: { tone: { $: 'tone' } }, children: ['tag'] },
      ],
    },
  ],
};

const alerts: SchemaNode = {
  type: 'Grid',
  props: { minChildWidth: '260px', gap: '300' },
  children: [
    {
      type: '$each',
      props: { items: STATUSES, as: 'tone' },
      children: [
        {
          type: 'Column',
          props: { gap: '200' },
          children: [
            { type: 'we-alert', props: { tone: { $: 'tone' } }, children: [{ $: '`A soft ${tone} alert`' }] },
            {
              type: 'we-alert',
              props: { variant: 'edge', tone: { $: 'tone' } },
              children: [{ $: '`An edge ${tone} alert`' }],
            },
          ],
        },
      ],
    },
  ],
};

/** A toned card: everything inside should draw in its family without being told. */
const tonedCard = (tone: string): SchemaNode => ({
  type: 'Card',
  props: { tone, bg: 'accent-soft', gap: '300', flex: '1', minWidth: '240px' },
  children: [
    { type: 'we-text', props: { variant: 'heading-sm', color: 'accent-text' }, children: [`A ${tone} card`] },
    { type: 'we-text', props: { color: 'text-muted' }, children: ['Its buttons, switch and bar follow its tone.'] },
    {
      type: 'Row',
      props: { gap: '200', wrap: true },
      children: [
        { type: 'we-button', props: { size: 'sm' }, children: ['Primary'] },
        { type: 'we-button', props: { size: 'sm', variant: 'soft' }, children: ['Soft'] },
      ],
    },
    { type: 'we-progress-bar', props: { value: 62 } },
    {
      type: 'Row',
      props: { gap: '400', ay: 'center' },
      children: [
        { type: 'we-switch', props: { checked: true, label: 'On' } },
        { type: 'we-checkbox', props: { checked: true, label: 'Ticked' } },
      ],
    },
  ],
});

const typeRoles: SchemaNode = {
  type: 'Column',
  props: { gap: '300' },
  children: [
    { type: 'we-text', props: { variant: 'overline' }, children: ['Overline — the name of a group'] },
    { type: 'we-text', props: { variant: 'heading-xl', tag: 'h1' }, children: ['Heading xl'] },
    { type: 'we-text', props: { variant: 'heading-lg', tag: 'h2' }, children: ['Heading lg'] },
    { type: 'we-text', props: { variant: 'heading-md', tag: 'h3' }, children: ['Heading md'] },
    { type: 'we-text', props: { variant: 'heading-sm', tag: 'h4' }, children: ['Heading sm'] },
    {
      type: 'we-text',
      props: { variant: 'body', tag: 'p' },
      children: ['Body text, the way most of a space reads. It should be comfortable at length.'],
    },
    { type: 'we-text', props: { variant: 'label' }, children: ['A label'] },
    { type: 'we-text', props: { variant: 'footnote', color: 'text-muted' }, children: ['A footnote, muted'] },
    { type: 'we-text', props: { color: 'text-faint' }, children: ['Faint text — placeholders and hints'] },
    {
      type: 'we-markdown',
      props: { content: '### A markdown heading\n\nWith **strong**, _emphasis_ and `code`.' },
    },
    {
      type: 'Row',
      props: { gap: '300', wrap: true },
      children: [
        {
          type: 'we-form-field',
          props: { label: 'A field label', description: 'And its description' },
          children: [{ type: 'we-input', props: { placeholder: 'Typed text' } }],
        },
      ],
    },
  ],
};

const elevation: SchemaNode = {
  type: 'Row',
  props: { gap: '400', wrap: true },
  children: [
    ...['sm', 'md', 'lg', 'xl', 'glow'].map((shadow): SchemaNode => ({
      type: 'Column',
      props: { bg: 'surface-raised', r: 'surface', p: '400', shadow, minWidth: '96px', ax: 'center' },
      children: [{ type: 'we-text', props: { variant: 'label' }, children: [shadow] }],
    })),
    {
      type: 'Column',
      props: {
        bg: 'surface-raised',
        r: 'surface',
        p: '400',
        shadow: 'glow',
        tone: 'teal',
        minWidth: '96px',
        ax: 'center',
      },
      children: [{ type: 'we-text', props: { variant: 'label' }, children: ['teal glow'] }],
    },
  ],
};

const surfaces: SchemaNode = {
  type: 'Column',
  props: { bg: 'page', r: 'surface', p: '400', gap: '300', border: '1px solid border' },
  children: [
    { type: 'we-text', props: { variant: 'label', color: 'text-muted' }, children: ['page'] },
    {
      type: 'Column',
      props: { bg: 'surface', r: 'surface', p: '400', gap: '300', border: '1px solid border' },
      children: [
        { type: 'we-text', props: { variant: 'label', color: 'text-muted' }, children: ['surface'] },
        {
          type: 'Row',
          props: { gap: '300', wrap: true },
          children: [
            {
              type: 'Column',
              props: { bg: 'surface-raised', r: 'surface', p: '400', shadow: 'md', flex: '1' },
              children: [{ type: 'we-text', props: { variant: 'label' }, children: ['surface-raised'] }],
            },
            {
              type: 'Column',
              props: { bg: 'surface-sunken', r: 'surface', p: '400', flex: '1' },
              children: [{ type: 'we-text', props: { variant: 'label' }, children: ['surface-sunken'] }],
            },
          ],
        },
      ],
    },
  ],
};

const states: SchemaNode = {
  type: 'Row',
  props: { gap: '500', wrap: true, ay: 'start' },
  children: [
    {
      type: 'Column',
      props: { minWidth: '220px', bg: 'surface-raised', r: 'surface', p: '200', shadow: 'lg' },
      children: [
        {
          type: 'we-menu',
          children: [
            { type: 'we-menu-group', props: { heading: 'A menu' } },
            { type: 'we-menu-item', children: ['An item — hover me'] },
            { type: 'we-menu-item', props: { selected: true }, children: ['The chosen item'] },
            { type: 'we-menu-item', props: { disabled: true }, children: ['A disabled item'] },
            { type: 'we-menu-item', props: { tone: 'danger' }, children: ['Delete'] },
          ],
        },
      ],
    },
    {
      type: 'Column',
      props: { gap: '300', minWidth: '260px', flex: '1' },
      children: [
        {
          type: 'we-tabs',
          props: { selectedKey: 'one' },
          children: [
            { type: 'we-tab', props: { key: 'one', label: 'Chosen tab' } },
            { type: 'we-tab', props: { key: 'two', label: 'Another' } },
            { type: 'we-tab', props: { key: 'three', label: 'Disabled', disabled: true } },
          ],
        },
        {
          type: 'Row',
          props: { gap: '200', wrap: true },
          children: [
            { type: 'we-button', props: { disabled: true }, children: ['Disabled'] },
            { type: 'we-button', props: { variant: 'soft', disabled: true }, children: ['Disabled soft'] },
            { type: 'we-button', props: { loading: true }, children: ['Loading'] },
          ],
        },
        { type: 'we-input', props: { placeholder: 'Focus me with Tab to see the ring' } },
        { type: 'we-input', props: { placeholder: 'A disabled field', disabled: true } },
        {
          type: 'we-select',
          props: {
            value: 'b',
            options: [
              { label: 'First', value: 'a' },
              { label: 'Second', value: 'b' },
              { label: 'Third', value: 'c' },
            ],
          },
        },
        { type: 'we-pagination', props: { page: 2, total: 5 } },
        { type: 'we-slider', props: { value: 40 } },
      ],
    },
  ],
};

/** The ten palette hues as their seven roles would be read: the fill, its label, the tint and its text. */
const palette: SchemaNode = {
  type: 'Grid',
  props: { minChildWidth: '110px', gap: '200' },
  children: [
    {
      type: '$each',
      props: { items: PALETTE, as: 'hue' },
      children: [
        {
          type: 'Column',
          props: { r: 'surface', overflow: 'hidden', border: '1px solid border' },
          children: [
            {
              type: 'Column',
              props: { bg: { $: 'hue' }, p: '300' },
              children: [
                { type: 'we-text', props: { color: { $: '`on-${hue}`' }, variant: 'label' }, children: [{ $: 'hue' }] },
              ],
            },
            {
              type: 'Column',
              props: { bg: { $: '`${hue}-soft`' }, p: '300' },
              children: [{ type: 'we-text', props: { color: { $: '`${hue}-text`' } }, children: ['tint · text'] }],
            },
          ],
        },
      ],
    },
  ],
};

const clusterNodes = Array.from({ length: 24 }, (_, i) => ({
  id: `n${i}`,
  kind: 'resource',
  type: 'idea',
  label: `${i + 1}`,
  data: { weight: (i * 7) % 24 },
}));
const clusterEdges = clusterNodes.flatMap((node, i) => {
  const group = Math.floor(i / 4) * 4;
  return i % 4 === 0 ? [] : [{ id: `e${i}`, source: `n${group}`, target: node.id, type: 'link' }];
});

const graph = (title: string, color: Record<string, unknown>): SchemaNode => ({
  type: 'Column',
  props: { gap: '200', flex: '1', minWidth: '280px' },
  children: [
    { type: 'we-text', props: { variant: 'label', color: 'text-muted' }, children: [title] },
    {
      type: 'Column',
      props: { height: '280px', r: 'surface', overflow: 'hidden', border: '1px solid border' },
      children: [
        {
          type: 'GraphView',
          props: {
            seeds: { literal: true, nodes: clusterNodes, edges: clusterEdges },
            layout: { type: 'force' },
            backdrop: { pattern: 'dots', gap: 24 },
            nodeStyle: [{ style: { size: 16, color } }],
            behaviours: ['select', 'pan-zoom'],
          },
        },
      ],
    },
  ],
});

export const themeLabTemplate = {
  type: 'Column',
  meta: {
    name: 'Theme lab',
    description: 'Every place a theme reaches, on one page — for seeing a theme while you edit it.',
    icon: 'palette',
    requires: { modules: ['graph'] },
  },
  props: { bg: 'page', minHeight: '100%', width: '100%', ax: 'center' },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: 'var(--we-layout-lg)', gap: '500', px: '400', py: '500' },
      children: [
        {
          type: 'Column',
          props: { gap: '200' },
          children: [
            { type: 'we-text', props: { variant: 'heading-xl', tag: 'h1' }, children: ['Theme lab'] },
            {
              type: 'we-text',
              props: { color: 'text-muted' },
              children: ['Open the theme panel beside this page: every change shows here, in every family and state.'],
            },
          ],
        },
        section('Tones and variants', 'Colour is tone, style is variant', toneRow),
        section('Alerts', 'Status, in both styles', alerts),
        section('Toned cards', 'Everything inside follows the card', {
          type: 'Row',
          props: { gap: '400', wrap: true },
          children: [tonedCard('accent'), tonedCard('danger'), tonedCard('teal'), tonedCard('purple')],
        }),
        section('Type roles', 'Headings, body, labels, overlines', typeRoles),
        section('Elevation', 'Shadow strength and glow', elevation),
        section('Surfaces', 'Page, surface, raised, sunken', surfaces),
        section('States', 'Hover, chosen, disabled, focus', states),
        section('Palette', 'The ten hues a community picks from', palette),
        section('Data', 'Categories from the palette; heat that holds in dark', {
          type: 'Row',
          props: { gap: '400', wrap: true },
          children: [
            graph('Clusters — community colours', { metric: 'community', scale: 'categorical' }),
            graph('Heat — weight', { metric: 'field', options: { from: 'weight' }, scale: 'heat' }),
          ],
        }),
      ],
    },
  ],
};
