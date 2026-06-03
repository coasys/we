import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/spinner';

const meta: Meta = {
  title: 'Primitives/Spinner',
  component: 'we-spinner',
  tags: ['autodocs'],
};
export default meta;

export const Basic: StoryObj = {
  render: () => html`<we-spinner></we-spinner>`,
};

export const Sizes: StoryObj = {
  render: () => html`
    <div style="display: flex; gap: 16px; align-items: center;">
      <we-spinner size="xs"></we-spinner>
      <we-spinner size="sm"></we-spinner>
      <we-spinner size="md"></we-spinner>
      <we-spinner size="lg"></we-spinner>
      <we-spinner size="xl"></we-spinner>
    </div>
  `,
};

export const CustomColor: StoryObj = {
  render: () => html`<we-spinner color="danger-500"></we-spinner>`,
};
