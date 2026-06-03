import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/menu';
import '../../src/primitives/menu-item';

const meta: Meta = {
  title: 'Primitives/Menu',
  component: 'we-menu',
  tags: ['autodocs'],
};
export default meta;

export const Basic: StoryObj = {
  render: () => html`
    <we-menu>
      <we-menu-item>Cut</we-menu-item>
      <we-menu-item>Copy</we-menu-item>
      <we-menu-item>Paste</we-menu-item>
    </we-menu>
  `,
};

export const WithIcons: StoryObj = {
  render: () => html`
    <we-menu>
      <we-menu-item>
        <we-icon slot="start" name="pencil" size="sm"></we-icon>
        Edit
      </we-menu-item>
      <we-menu-item>
        <we-icon slot="start" name="copy" size="sm"></we-icon>
        Duplicate
      </we-menu-item>
      <we-menu-item>
        <we-icon slot="start" name="trash" size="sm"></we-icon>
        Delete
      </we-menu-item>
    </we-menu>
  `,
};

export const WithSelectedItem: StoryObj = {
  render: () => html`
    <we-menu>
      <we-menu-item>Option A</we-menu-item>
      <we-menu-item selected>Option B (selected)</we-menu-item>
      <we-menu-item>Option C</we-menu-item>
    </we-menu>
  `,
};
