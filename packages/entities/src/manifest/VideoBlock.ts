import type { CoreEntityDef } from './defs';

export const VideoBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    blockable: true,
    description: 'A video, from a link',
    // A form: filled in where a record is given one inline, and wherever one is made on its own.
    authoring: { fields: ['url', 'title'] },
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
