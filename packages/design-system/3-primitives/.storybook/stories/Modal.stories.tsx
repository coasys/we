import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/modal';
import '../../src/primitives/button';

const meta: Meta = {
  title: 'Primitives/Modal',
  component: 'we-modal',
  tags: ['autodocs'],
};
export default meta;

export const Basic: StoryObj = {
  render: () => html`
    <we-modal style="position: relative; width: 500px; height: 300px;">
      <we-text size="lg" weight="bold">Modal Title</we-text>
      <we-text>This is the modal body content.</we-text>
      <we-button>Confirm</we-button>
    </we-modal>
  `,
};

export const HiddenCloseButton: StoryObj = {
  render: () => html`
    <we-modal hideclosebutton style="position: relative; width: 500px; height: 300px;">
      <we-text size="lg" weight="bold">No Close Button</we-text>
      <we-text>Close button is hidden on this modal.</we-text>
    </we-modal>
  `,
};
