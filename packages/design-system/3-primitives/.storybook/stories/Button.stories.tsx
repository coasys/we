import type { Meta, StoryObj } from '@storybook/web-components';
import { html } from 'lit';
import './../../src/components/Button';
import './../../src/variables.css';

// type size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const meta: Meta = {
  title: 'Elements/Button',
  component: 'we-button',
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'primary', 'link', 'subtle', 'transparent', 'ghost'],
      // table: { defaultValue: { summary: 'default' } },
    },
    size: {
      control: 'select',
      options: ['undefined', 'xs', 'sm', 'md', 'lg', 'xl'],
      // table: { defaultValue: { summary: 'md' } },
    },
  },
};
export default meta;

// is it possible to write function that parses typescript declaration or component file & generates storybook args?

export const Basic: StoryObj = {
  args: {
    text: 'Button',
    variant: 'default',
    size: 'md',
    href: '',
    disabled: false,
    loading: false,
    square: false,
    full: false,
    circle: false,
  },
  // render: (args) => {
  //   const attrs = [
  //     args.variant && args.variant !== 'default' && `variant="${args.variant}"`,
  //     args.size && `size="${args.size}"`,
  //     args.disabled && 'disabled',
  //     args.loading && 'loading',
  //   ]
  //     .filter(Boolean)
  //     .join(' ');

  //   return `<we-button ${attrs}>${args.text}</we-button>`;
  // },
  // parameters: { docs: { source: { transform: (code: string) => code.replace(/=""/g, '') } } },
  render: (args) => {
    //
    return html`<we-button
      variant="${args.variant}"
      size="${args.size}"
      ?disabled="${args.disabled}"
      ?loading=${args.loading}
      ?square="${args.square}"
      ?full="${args.full}"
      ?circle="${args.circle}"
      >${args.text}</we-button
    >`;
  },
  // html`<we-button
  //   variant="${args.variant}"
  //   size="${args.size}"
  //   ?disabled="${args.disabled}"
  //   ?loading=${args.loading}
  //   ?square="${args.square}"
  //   ?full="${args.full}"
  //   ?circle="${args.circle}"
  //   >${args.text}</we-button
  // >`,
};

// export const Basic: StoryObj = {
//   args: {
//     text: 'Button',
//     variant: '',
//     size: 'md',
//     disabled: false,
//     loading: false,
//   },
//   parameters: {
//     docs: {
//       source: {
//         format: 'html',
//         transform: (code: string) => {
//           return code.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/=""/g, '');
//         },
//       },
//     },
//   },
//   render: (args) => {
//     const attrs = [
//       args.variant && `variant="${args.variant}"`,
//       args.size && `size="${args.size}"`,
//       args.disabled && 'disabled',
//       args.loading && 'loading',
//     ]
//       .filter(Boolean)
//       .join(' ');

//     return `<we-button ${attrs}>${args.text}</we-button>`;
//   },
// };
