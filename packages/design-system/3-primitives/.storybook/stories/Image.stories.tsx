import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/image';

const meta: Meta = {
  title: 'Primitives/Image',
  component: 'we-image',
  tags: ['autodocs'],
};
export default meta;

export const Basic: StoryObj = {
  render: () => html`
    <we-image src="https://picsum.photos/300/200" alt="Sample image" width="300" height="200"></we-image>
  `,
};

export const ObjectFit: StoryObj = {
  render: () => html`
    <div style="display: flex; gap: 16px;">
      <we-image src="https://picsum.photos/300/200" alt="Cover" fit="cover" width="150" height="150"></we-image>
      <we-image src="https://picsum.photos/300/200" alt="Contain" fit="contain" width="150" height="150"></we-image>
    </div>
  `,
};

export const LazyLoading: StoryObj = {
  render: () => html` <we-image src="https://picsum.photos/400/300" alt="Lazy loaded" loading="lazy"></we-image> `,
};
