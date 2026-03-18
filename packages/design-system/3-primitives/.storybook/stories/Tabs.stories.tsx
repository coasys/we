import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/tabs';
import '../../src/primitives/tab';

const meta: Meta = {
  title: 'Primitives/Tabs',
  component: 'we-tabs',
  tags: ['autodocs'],
};
export default meta;

export const Basic: StoryObj = {
  render: () => html`
    <we-tabs activeKey="tab1" direction="row" gap="100">
      <we-tab slot="tab" key="tab1" label="Tab 1" active></we-tab>
      <we-tab slot="tab" key="tab2" label="Tab 2"></we-tab>
      <we-tab slot="tab" key="tab3" label="Tab 3"></we-tab>
    </we-tabs>
  `,
};
