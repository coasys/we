import type { CoreEntityDef } from './defs';

export const VideoBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    blockable: true,
    /*
      A form, so a record can be given one inline — a sighting's photo, added where the sighting is
      written. Not offered in "create something": an image with nothing to belong to is not a thing a
      person sets out to make, and the composer is where one is put into a document.
    */
    authoring: { fields: ['url', 'title'], offered: false },
    flag: { predicate: 'we://flag', value: 'we://video_block' },
    properties: {
      title: { type: 'string', predicate: 'we://title', default: '' },
      url: { type: 'string', predicate: 'we://url', required: true, default: '' },
      duration: { type: 'number', predicate: 'we://duration', default: 0 },
      thumbnail: { type: 'string', predicate: 'we://thumbnail', default: '' },
      provider: { type: 'string', predicate: 'we://provider', default: '' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
