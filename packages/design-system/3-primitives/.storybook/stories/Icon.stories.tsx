import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/icon';

const meta: Meta = {
  title: 'Primitives/Icon',
  component: 'we-icon',
  tags: ['autodocs'],
};
export default meta;

export const Basic: StoryObj = {
  args: { name: 'house', size: 'md' },
  render: (args) => html`<we-icon name="${args.name}" size="${args.size}"></we-icon>`,
};

export const Sizes: StoryObj = {
  render: () => html`
    <div style="display: flex; align-items: center; gap: 12px;">
      <we-icon name="star" size="xxs"></we-icon>
      <we-icon name="star" size="xs"></we-icon>
      <we-icon name="star" size="sm"></we-icon>
      <we-icon name="star" size="md"></we-icon>
      <we-icon name="star" size="lg"></we-icon>
      <we-icon name="star" size="xl"></we-icon>
      <we-icon name="star" size="xxl"></we-icon>
    </div>
  `,
};

export const Weights: StoryObj = {
  render: () => html`
    <div style="display: flex; align-items: center; gap: 12px;">
      <we-icon name="heart" weight="thin"></we-icon>
      <we-icon name="heart" weight="light"></we-icon>
      <we-icon name="heart" weight="regular"></we-icon>
      <we-icon name="heart" weight="bold"></we-icon>
      <we-icon name="heart" weight="fill"></we-icon>
    </div>
  `,
};

export const WithColor: StoryObj = {
  render: () => html`
    <div style="display: flex; align-items: center; gap: 12px;">
      <we-icon name="check-circle" color="success-500" size="lg"></we-icon>
      <we-icon name="warning" color="warning-500" size="lg"></we-icon>
      <we-icon name="x-circle" color="danger-500" size="lg"></we-icon>
    </div>
  `,
};
