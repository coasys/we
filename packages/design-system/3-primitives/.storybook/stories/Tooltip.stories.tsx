import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/tooltip';

const meta: Meta = {
  title: 'Primitives/Tooltip',
  component: 'we-tooltip',
  tags: ['autodocs'],
};
export default meta;

export const Basic: StoryObj = {
  render: () => html`
    <we-tooltip title="This is a tooltip">
      <span style="padding: 8px; border: 1px dashed #ccc;">Hover me</span>
    </we-tooltip>
  `,
};

export const Placements: StoryObj = {
  render: () => html`
    <div style="display: flex; gap: 24px; padding: 48px; justify-content: center;">
      <we-tooltip title="Top" placement="top">
        <we-button>Top</we-button>
      </we-tooltip>
      <we-tooltip title="Right" placement="right">
        <we-button>Right</we-button>
      </we-tooltip>
      <we-tooltip title="Bottom" placement="bottom">
        <we-button>Bottom</we-button>
      </we-tooltip>
      <we-tooltip title="Left" placement="left">
        <we-button>Left</we-button>
      </we-tooltip>
    </div>
  `,
};
