import type { CoreEntityDef } from '../defs';

export const AudioBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: {"predicate": "we://flag", "value": "we://audio_block"},
    properties: {
      title: { type: "string", predicate: "we://title", required: true, default: "" },
      artist: { type: "string", predicate: "we://artist", default: "" },
      audioUrl: { type: "string", predicate: "we://audio_url", required: true, format: "file", readAs: "dataUri", default: "" },
      duration: { type: "number", predicate: "we://duration", default: 0 },
      albumArt: { type: "string", predicate: "we://album_art", default: "" },
      version: { type: "number", predicate: "we://version", default: 0 },
    },
    relations: {
    },
  },
};
