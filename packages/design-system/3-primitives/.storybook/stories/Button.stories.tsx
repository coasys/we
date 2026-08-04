import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/avatar';
import '../../src/primitives/button';
import '../../src/primitives/text';

const meta: Meta = {
  title: 'Primitives/Button',
  component: 'we-button',
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'ghost', 'danger', 'outline', 'bare'],
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
      <we-button variant="bare">Bare</we-button>
    </div>
  `,
};

/**
 * `bare` is the appearance-free variant: a real `<button>` with no chrome of its own — no
 * background, no hover, no padding, no radius, and colour inherited rather than set. Use it to
 * make arbitrary content clickable while keeping button semantics (keyboard activation, the
 * `disabled` prop, the AT role) that a `div`/`Column` with an `onClick` does not give you.
 *
 * The affordance is expected to come from the wrapped content, so give the child its own
 * `hoverProps` when the content does not already read as interactive.
 */
export const Bare: StoryObj = {
  render: () => html`
    <div style="display: flex; gap: 16px; align-items: flex-start;">
      <we-button variant="bare">
        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; width: 150px;">
          <we-avatar initials="AB" size="lg"></we-avatar>
          <we-text variant="footnote" truncate>Account with a long name</we-text>
        </div>
      </we-button>
      <we-button variant="bare" disabled>
        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; width: 150px;">
          <we-avatar initials="CD" size="lg"></we-avatar>
          <we-text variant="footnote" truncate>Disabled</we-text>
        </div>
      </we-button>
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

/**
 * Every variant carries the same focus ring, driven by `focusProps` in DEFAULT_PROPS and
 * coloured by `--we-ring-color` (the themeable `ringColor` key).
 *
 * **Tab into these buttons** to see it — then click one with the mouse and note that no ring
 * appears. The DS focus state resolves to `:focus-visible`, not `:focus`/`:focus-within`, so
 * the indicator shows up for keyboard navigation without leaving a ring stuck on every button
 * the user clicks. `bare` is included deliberately: it is the variant with no resting
 * appearance, so the ring is the only thing marking it as focused.
 */
export const FocusRing: StoryObj = {
  render: () => html`
    <div style="display: flex; gap: 8px; align-items: center;">
      <we-button variant="primary">Primary</we-button>
      <we-button variant="ghost">Ghost</we-button>
      <we-button variant="outline">Outline</we-button>
      <we-button variant="bare">Bare</we-button>
      <we-button variant="primary" disabled>Disabled (no ring)</we-button>
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
