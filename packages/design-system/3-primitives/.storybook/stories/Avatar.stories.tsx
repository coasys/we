import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/avatar';

const meta: Meta = {
  title: 'Primitives/Avatar',
  component: 'we-avatar',
  tags: ['autodocs'],
};
export default meta;

export const WithInitials: StoryObj = {
  render: () => html`<we-avatar initials="JD"></we-avatar>`,
};

export const WithIcon: StoryObj = {
  render: () => html`<we-avatar icon="user"></we-avatar>`,
};

export const WithImage: StoryObj = {
  render: () => html` <we-avatar image="https://i.pravatar.cc/100?img=3"></we-avatar> `,
};

export const Sizes: StoryObj = {
  render: () => html`
    <div style="display: flex; gap: 8px; align-items: center;">
      <we-avatar initials="XS" size="xs"></we-avatar>
      <we-avatar initials="SM" size="sm"></we-avatar>
      <we-avatar initials="MD"></we-avatar>
      <we-avatar initials="LG" size="lg"></we-avatar>
      <we-avatar initials="XL" size="xl"></we-avatar>
    </div>
  `,
};

export const Online: StoryObj = {
  render: () => html`<we-avatar initials="JD" online></we-avatar>`,
};

export const Selected: StoryObj = {
  render: () => html`<we-avatar initials="JD" selected></we-avatar>`,
};
