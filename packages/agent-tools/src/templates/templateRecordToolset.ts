/**
 * templateRecordToolset — `createTemplateToolset` over a stored `Template` record: the record in,
 * the properties to write back out.
 *
 * A host holds records, not schemas. Reading a template out of one and writing it back the way the
 * app does is WE's knowledge — the file format, the version the app watches, who a change is
 * recorded as — so it lives here rather than in every host. What comes out is what the app's own
 * save writes, which is what lets an open screen pick the change up as it would a save from another
 * device.
 */
import { decodeTemplateFile, encodeTemplateFile, type TemplateSchema } from '@we/schema-shared';

import type { RecordEdit, RecordToolsetEntry, Toolset } from '../core/toolset';
import { createTemplateToolset } from './templateToolset';

export const templateRecordToolset: RecordToolsetEntry = {
  appliesTo: ['Template'],

  async open({ record, request, models, author }): Promise<Toolset<RecordEdit>> {
    if (!templateRecordToolset.appliesTo.includes(record.className))
      throw new Error(`The template toolset edits Template records, not ${record.className}.`);
    const stored = decodeTemplateFile(record.properties.schema);
    if (!stored) throw new Error(`Template ${record.id} holds no schema this build can read.`);

    // Who saved it last is the app's bookkeeping, not part of the design: the model is not shown it,
    // and the write records whoever this one goes out as.
    const { author: _previous, ...template } = stored;
    const toolset = await createTemplateToolset({ template, request, models });
    const version = Number(record.properties.version) || 1;

    return {
      ...toolset,
      result() {
        const edit = toolset.result();
        if (!edit.changed) return { changed: false, properties: {} };
        const schema = { ...edit.template, ...(author ? { author } : {}) } as TemplateSchema;
        return {
          changed: true,
          // The same pair the app's save writes, and for the same reason: a screen showing this
          // template hears of the change through the version, so the two land together.
          properties: { schema: encodeTemplateFile(schema, { savedAt: Date.now() }), version: version + 1 },
        };
      },
    };
  },
};
