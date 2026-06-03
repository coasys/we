import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import '../../src/primitives/input';
import '../../src/primitives/form-field';

const meta: Meta = {
  title: 'Primitives/Input',
  component: 'we-input',
  tags: ['autodocs'],
};
export default meta;

export const Basic: StoryObj = {
  args: { placeholder: 'Enter text…' },
  render: (args) => html`
    <we-form-field label="Name">
      <we-input placeholder="${args.placeholder}"></we-input>
    </we-form-field>
  `,
};

export const WithDescription: StoryObj = {
  render: () => html`
    <we-form-field label="Email" description="We'll never share your email.">
      <we-input placeholder="you@example.com"></we-input>
    </we-form-field>
  `,
};

export const WithError: StoryObj = {
  render: () => html`
    <we-form-field label="Username" error="Username must be at least 3 characters.">
      <we-input value="a"></we-input>
    </we-form-field>
  `,
};

export const Disabled: StoryObj = {
  render: () => html`
    <we-form-field label="Locked">
      <we-input value="Can't edit" disabled></we-input>
    </we-form-field>
  `,
};

export const Password: StoryObj = {
  render: () => html`
    <we-form-field label="Password">
      <we-input type="password" placeholder="••••••••"></we-input>
    </we-form-field>
  `,
};

export const Bare: StoryObj = {
  render: () => html`<we-input placeholder="Search…"></we-input>`,
};
