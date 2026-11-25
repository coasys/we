import type { ModuleEntities } from '@we/module-shared';

/**
 * The Feed's manifest: no entities and no operations of its own. It writes WE's vocabulary.
 *
 * A Feed line is a message — a collection holding its blocks — written through the host's documents
 * as a post is (`RecordsKernel.documents`), and a reply is a message in response to a line, threaded
 * under its thread's subject by that same write. So the reply that used to be declared here
 * (`feed.reply`, a bare `TextBlock` made a response) is `core.createPost`'s now, with every other
 * composed document.
 */
export const FEED_MANIFEST: ModuleEntities['manifest'] = {
  version: '1',
  entities: {},
};
