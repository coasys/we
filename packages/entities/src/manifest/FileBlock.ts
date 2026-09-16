import type { CoreEntityDef } from './defs';

export const FileBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    blockable: true,
    /*
      A form, so a record can be given one inline — a sighting's photo, added where the sighting is
      written. Not offered in "create something": an image with nothing to belong to is not a thing a
      person sets out to make, and the composer is where one is put into a document.
    */
    authoring: { fields: ['url', 'name', 'title'], offered: false },
    flag: { predicate: 'we://flag', value: 'we://file_block' },
    properties: {
      title: { type: 'string', predicate: 'we://title', default: '' },
      name: { type: 'string', predicate: 'we://name', required: true, default: '' },
      url: { type: 'string', predicate: 'we://url', required: true, format: 'file', readAs: 'dataUri', default: '' },
      mimeType: { type: 'string', predicate: 'we://mime_type', default: '' },
      size: { type: 'number', predicate: 'we://size', default: 0 },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
