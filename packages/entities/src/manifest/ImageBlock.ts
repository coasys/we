import type { CoreEntityDef } from './defs';

export const ImageBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    blockable: true,
    flag: { predicate: 'we://flag', value: 'we://image_block' },
    properties: {
      src: { type: 'string', predicate: 'we://src', required: true, format: 'file', readAs: 'dataUri', default: '' },
      altText: { type: 'string', predicate: 'we://altText', default: '' },
      width: { type: 'number', predicate: 'we://width', default: 0 },
      height: { type: 'number', predicate: 'we://height', default: 0 },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
