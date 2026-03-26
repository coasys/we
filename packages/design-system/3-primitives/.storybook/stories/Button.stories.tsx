import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/button';

const meta: Meta = {
  title: 'Primitives/Button',
  component: 'we-button',
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost', 'danger', 'outline'],
      description: 'Button variant',
    },
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg'],
      description: 'Button size',
    },
    bg: { control: 'text', description: 'Background color token (overrides variant)' },
    color: { control: 'text', description: 'Text color token (overrides variant)' },
    r: { control: 'text', description: 'Border radius token' },
    px: { control: 'text', description: 'Horizontal padding token (overrides size)' },
    py: { control: 'text', description: 'Vertical padding token (overrides size)' },
  },
};
export default meta;

export const Basic: StoryObj = {
  args: { text: 'Button', disabled: false, loading: false },
  render: (args) => html`<we-button ?disabled="${args.disabled}" ?loading=${args.loading}>${args.text}</we-button>`,
};

export const Variants: StoryObj = {
  render: () => html`
    <div style="display: flex; gap: 8px; align-items: center;">
      <we-button variant="primary">Primary</we-button>
      <we-button variant="secondary">Secondary</we-button>
      <we-button variant="ghost">Ghost</we-button>
      <we-button variant="danger">Danger</we-button>
      <we-button variant="outline">Outline</we-button>
    </div>
  `,
};

export const Sizes: StoryObj = {
  render: () => html`
    <div style="display: flex; gap: 8px; align-items: center;">
      <we-button size="xs">Extra Small</we-button>
      <we-button size="sm">Small</we-button>
      <we-button size="md">Medium</we-button>
      <we-button size="lg">Large</we-button>
    </div>
  `,
};

export const VariantsWithSizes: StoryObj = {
  render: () => html`
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <div style="display: flex; gap: 8px; align-items: center;">
        <we-button variant="primary" size="sm">Primary SM</we-button>
        <we-button variant="secondary" size="sm">Secondary SM</we-button>
        <we-button variant="danger" size="sm">Danger SM</we-button>
      </div>
      <div style="display: flex; gap: 8px; align-items: center;">
        <we-button variant="primary" size="lg">Primary LG</we-button>
        <we-button variant="secondary" size="lg">Secondary LG</we-button>
        <we-button variant="danger" size="lg">Danger LG</we-button>
      </div>
    </div>
  `,
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

export const CustomOverrides: StoryObj = {
  render: () => html`
    <div style="display: flex; gap: 8px;">
      <we-button variant="primary" bg="green-500">Custom BG</we-button>
      <we-button variant="secondary" r="pill">Pill Radius</we-button>
      <we-button variant="ghost" color="primary-500">Custom Color</we-button>
    </div>
  `,
};
