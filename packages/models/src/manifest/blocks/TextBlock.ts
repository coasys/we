import type { CoreEntityDef } from '../defs';

export const TextBlock: CoreEntityDef = {
  base: 'WeNode',
  entity: {
    flag: {"predicate": "we://flag", "value": "we://text_block"},
    properties: {
      type: { type: "string", predicate: "we://type", default: "" },
      direction: { type: "string", predicate: "we://direction", default: "" },
      format: { type: "string", predicate: "we://format", default: "" },
      indent: { type: "number", predicate: "we://indent", default: 0 },
      textFormat: { type: "number", predicate: "we://textFormat", default: 0 },
      textStyle: { type: "string", predicate: "we://textStyle", default: "" },
      listType: { type: "string", predicate: "we://listType", default: "" },
      start: { type: "number", predicate: "we://start", default: 0 },
      tag: { type: "string", predicate: "we://tag", default: "" },
      text: { type: "string", predicate: "we://text", default: "" },
      version: { type: "number", predicate: "we://version", default: 0 },
    },
    relations: {
    },
  },
};
