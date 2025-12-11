/* @refresh reload */
import './index.scss';
import '@we/tokens/css';
import '@we/themes';
import '@we/elements/solid';
import '@we/components/styles';
import '@we/widgets/styles';
import '@we/pages/styles';
import '@we/templates/styles';

import { render } from 'solid-js/web';

import App from './App';

const root = document.getElementById('root');
if (import.meta.env.DEV && !(root instanceof HTMLElement)) console.error('Root element not found!');

render(() => <App />, root!);
