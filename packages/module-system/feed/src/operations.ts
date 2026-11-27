import { TYPED } from '@we/messages';
import type { ModuleEntities } from '@we/module-shared';

/**
 * The Feed's own write, declared: answering a line.
 *
 * A Feed line is one `TextBlock` with its `source`, not a post, so a reply is too: drawn by the same
 * line, read by the same window. What makes it a reply is the two links every response has — to the
 * line it answers (`responses`, made with the record) and from its thread's subject (`core.thread`,
 * the same step a composed reply takes), so the whole conversation under a line is one read. Which
 * record the subject is, and its entity, are read by the host before the run (`threadSubject`).
 *
 * Who a line mentions is worked out from its marks here, where the module never reads them: the
 * marks are the composer's, passed through, and the mention links are part of the same write.
 *
 * No entities of its own: the Feed writes WE's vocabulary.
 */
export const FEED_MANIFEST: ModuleEntities['manifest'] = {
  version: '1',
  entities: {},
  operations: {
    reply: {
      description:
        'Answer one line with a typed line of its own: a response to it, threaded under the subject of the thread it is in, mentioning whoever its marks name.',
      params: {
        line: { type: 'string', required: true, description: 'The line answered.' },
        text: { type: 'string', required: true, description: 'What the reply says.' },
        marks: { type: 'list', description: 'Its marks, as the composer gave them; absent when it has none.' },
        thread: { type: 'string', description: 'The subject of the thread it joins.' },
        threadEntity: { type: 'string', description: 'The subject’s entity.' },
      },
      steps: [
        {
          create: {
            as: 'made',
            entity: 'TextBlock',
            fields: {
              text: { $: 'text' },
              source: TYPED,
              // Absent when the line has none, and then not written.
              marks: { $: 'marks' },
              mentions: { $: "distinct(marks.filter(m, m.type == 'mention' && m.did).map(m, m.did))" },
            },
            parent: { id: { $: 'line' }, relation: 'responses' },
          },
        },
        {
          call: {
            operation: 'core.thread',
            args: { record: { $: 'made.id' }, thread: { $: 'thread' }, threadEntity: { $: 'threadEntity' } },
          },
          when: { $: 'thread && threadEntity' },
        },
      ],
      returns: { $: 'made.id' },
    },
  },
};
