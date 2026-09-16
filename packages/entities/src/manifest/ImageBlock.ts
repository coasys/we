import type { CoreEntityDef } from './defs';

export const ImageBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    blockable: true,
    /*
      A form, so a record can be given one inline — a sighting's photo, added where the sighting is
      written. Not offered in "create something": an image with nothing to belong to is not a thing a
      person sets out to make, and the composer is where one is put into a document.
    */
    authoring: { fields: ['src', 'altText'], offered: false },
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
