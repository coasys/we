import type { RouteSchema } from '@we/schema-shared';

export const cardsRoute: RouteSchema = {
  path: '/cards',
  type: 'Column',
  //   $localState: {
  //     createSpaceOpen: { type: 'boolean', initial: false },
  //   },
  children: [],
};
