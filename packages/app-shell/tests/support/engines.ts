/**
 * The engines every store test runs under: Solid, the test port, and Vue's reactivity. A store that
 * passes under all three is written against the port, not against any one engine's habits.
 */
import type { ReactivityPort } from '@we/reactivity';
import { createTestReactivity } from '@we/reactivity/testing';
import { solidReactivity } from '@we/reactivity-solid';

import { createVueReactivity } from './vueReactivity';

export const reactivityPorts: [string, () => ReactivityPort][] = [
  ['Solid', () => solidReactivity],
  ['the test port', () => createTestReactivity()],
  ['Vue', createVueReactivity],
];
