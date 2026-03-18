import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/button';

const meta: Meta = {
  title: 'Primitives/Button',
  component: 'we-button',
  tags: ['autodocs'],
  argTypes: {
    bg: { control: 'text', description: 'Background color token' },
    color: { control: 'text', description: 'Text color token' },
    r: { control: 'text', description: 'Border radius token' },
    px: { control: 'text', description: 'Horizontal padding token' },
    py: { control: 'text', description: 'Vertical padding token' },
  },
};
export default meta;

export const Basic: StoryObj = {
  args: { text: 'Button', disabled: false, loading: false },
  render: (args) => html`<we-button ?disabled="${args.disabled}" ?loading=${args.loading}>${args.text}</we-button>`,
};

export const WithHref: StoryObj = {
  render: () => html`<we-button href="#">Link Button</we-button>`,
};

export const Loading: StoryObj = {
  render: () => html`<we-button loading>Saving…</we-button>`,
};

export const Disabled: StoryObj = {
  render: () => html`<we-button disabled>Can't click</we-button>`,
};

export const CustomColors: StoryObj = {
  render: () => html`
    <div style="display: flex; gap: 8px;">
      <we-button bg="primary-500" color="ui-0">Primary</we-button>
      <we-button bg="success-100" color="success-700">Success</we-button>
      <we-button bg="danger-100" color="danger-700">Danger</we-button>
      <we-button bg="transparent" color="primary-500">Ghost</we-button>
    </div>
  `,
};
