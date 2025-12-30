// import type { Preview } from '@storybook/html-vite';
import { setCustomElementsManifest } from '@storybook/web-components';
import customElements from '../custom-elements.json';
// import '../src/main.ts';
import '../src/themes/black.css';
import '../src/themes/cyberpunk.css';
import '../src/themes/dark.css';
import '../src/themes/retro.css';

setCustomElementsManifest(customElements);

const preview = {
  parameters: {
    actions: { argTypesRegex: '^on[A-Z].*' },
    // controls: {
    //   matchers: {
    //     color: /(background|color)$/i,
    //     date: /Date$/i,
    //   },
    // },
    backgrounds: { disable: true },
  },
  globalTypes: {
    theme: {
      description: 'Change the global theme',
      toolbar: {
        title: 'Theme',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
          { value: 'retro', title: 'Retro', icon: 'browser' },
          { value: 'cyberpunk', title: 'Cyberpunk', icon: 'lightning' },
          { value: 'black', title: 'Black', icon: 'circle' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    theme: 'light',
  },
  decorators: [
    (Story, context) => {
      // apply global theme when changed in toolbar
      const selectedTheme = context.globals.theme || 'light';
      document.documentElement.className = selectedTheme;
      document.body.style.backgroundColor = 'var(--j-color-ui-100)';

      return Story();
    },
  ],
};

export default preview;
