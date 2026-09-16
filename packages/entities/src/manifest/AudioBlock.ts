import type { CoreEntityDef } from './defs';

export const AudioBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    blockable: true,
    /*
      A form, so a record can be given one inline — a sighting's photo, added where the sighting is
      written. Not offered in "create something": an image with nothing to belong to is not a thing a
      person sets out to make, and the composer is where one is put into a document.
    */
    authoring: { fields: ['audioUrl', 'title', 'artist'], offered: false },
    flag: { predicate: 'we://flag', value: 'we://audio_block' },
    properties: {
      title: { type: 'string', predicate: 'we://title', required: true, default: '' },
      artist: { type: 'string', predicate: 'we://artist', default: '' },
      audioUrl: {
        type: 'string',
        predicate: 'we://audio_url',
        required: true,
        format: 'file',
        readAs: 'dataUri',
        default: '',
      },
      duration: { type: 'number', predicate: 'we://duration', default: 0 },
      albumArt: { type: 'string', predicate: 'we://album_art', default: '' },
      version: { type: 'number', predicate: 'we://version', default: 0 },
    },
    relations: {},
  },
};
