import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/badge';

const meta: Meta = {
  title: 'Primitives/Badge',
  component: 'we-badge',
  tags: ['autodocs'],
};
export default meta;

export const Basic: StoryObj = {
  render: () => html`<we-badge>Default</we-badge>`,
};

export const Variants: StoryObj = {
  render: () => html`
    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
      <we-badge>Default</we-badge>
      <we-badge variant="primary">Primary</we-badge>
      <we-badge variant="success">Success</we-badge>
      <we-badge variant="warning">Warning</we-badge>
      <we-badge variant="danger">Danger</we-badge>
    </div>
  `,
};

export const Sizes: StoryObj = {
  render: () => html`
    <div style="display: flex; gap: 8px; align-items: center;">
      <we-badge size="sm">Small</we-badge>
      <we-badge>Medium</we-badge>
      <we-badge size="lg">Large</we-badge>
    </div>
  `,
};

export const CustomColors: StoryObj = {
  render: () => html`
    <we-badge bg="primary-100" color="primary-600">Custom</we-badge>
  `,
};
