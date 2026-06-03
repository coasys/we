import type { RouteSchema } from '@we/schema-shared';

export const graphRoute: RouteSchema = {
  path: '/graph',
  type: 'Column',
  //   $localState: {
  //     createSpaceOpen: { type: 'boolean', initial: false },
  //   },
  children: [],
};
