import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/text';

const meta: Meta = {
  title: 'Primitives/Text',
  component: 'we-text',
  tags: ['autodocs'],
};
export default meta;

export const Basic: StoryObj = {
  render: () => html`<we-text>Hello World</we-text>`,
};

export const Heading: StoryObj = {
  render: () => html`
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <we-text tag="h1" fontSize="900">Heading 1</we-text>
      <we-text tag="h2" fontSize="800">Heading 2</we-text>
      <we-text tag="h3" fontSize="700">Heading 3</we-text>
      <we-text tag="h4" fontSize="600">Heading 4</we-text>
    </div>
  `,
};

export const WithColor: StoryObj = {
  render: () => html`
    <div style="display: flex; flex-direction: column; gap: 8px;">
      <we-text color="primary-500">Primary</we-text>
      <we-text color="success-500">Success</we-text>
      <we-text color="danger-500">Danger</we-text>
      <we-text color="neutral-400">Muted</we-text>
    </div>
  `,
};

export const Uppercase: StoryObj = {
  render: () => html`<we-text uppercase fontWeight="600">Uppercased Text</we-text>`,
};
