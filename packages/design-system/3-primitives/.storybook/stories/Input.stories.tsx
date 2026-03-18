import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/input';

const meta: Meta = {
  title: 'Primitives/Input',
  component: 'we-input',
  tags: ['autodocs'],
};
export default meta;

export const Basic: StoryObj = {
  args: { placeholder: 'Enter text…', label: 'Name' },
  render: (args) =>
    html`<we-input placeholder="${args.placeholder}" label="${args.label}"></we-input>`,
};

export const WithHelpText: StoryObj = {
  render: () =>
    html`<we-input label="Email" placeholder="you@example.com" helptext="We'll never share your email."></we-input>`,
};

export const WithError: StoryObj = {
  render: () =>
    html`<we-input label="Username" value="a" error errortext="Username must be at least 3 characters."></we-input>`,
};

export const Disabled: StoryObj = {
  render: () => html`<we-input label="Locked" value="Can't edit" disabled></we-input>`,
};

export const Password: StoryObj = {
  render: () => html`<we-input label="Password" type="password" placeholder="••••••••"></we-input>`,
};
