import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/popover';
import '../../src/primitives/button';
import '../../src/primitives/menu';
import '../../src/primitives/menu-item';

const meta: Meta = {
  title: 'Primitives/Popover',
  component: 'we-popover',
  tags: ['autodocs'],
};
export default meta;

export const Basic: StoryObj = {
  render: () => html`
    <we-popover placement="bottom">
      <we-button slot="trigger">Open Popover</we-button>
      <div slot="content" style="padding: 12px; background: white; border: 1px solid #ddd; border-radius: 8px;">
        Popover content
      </div>
    </we-popover>
  `,
};

export const WithMenu: StoryObj = {
  render: () => html`
    <we-popover placement="bottom-start">
      <we-button slot="trigger">Actions</we-button>
      <we-menu slot="content">
        <we-menu-item>Edit</we-menu-item>
        <we-menu-item>Delete</we-menu-item>
      </we-menu>
    </we-popover>
  `,
};
