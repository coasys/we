/**
 * The people who appear in every fixture.
 *
 * One cast across all six so that comparing two templates side by side compares the *templates* —
 * different names and different faces in each would read as a difference in design.
 *
 * Note the accent in Sorensen. Profile fields are ordinary model properties, so they carry non-ASCII
 * safely; a message *body* does not, because `createBlocks` encodes editor state as UTF-8 and
 * `decodeEditorState` reads it back with a bare `atob`. That mismatch is a real bug in the app (see
 * the round-trip test), and until it is fixed a fixture's `body` strings have to stay ASCII while
 * its names need not.
 */
import type { FixtureAgent } from './types';

export const ADA = 'did:preview:ada';
export const BO = 'did:preview:bo';
export const CY = 'did:preview:cy';
export const DEE = 'did:preview:dee';

export const CAST: FixtureAgent[] = [
  { did: ADA, firstName: 'Ada', lastName: 'Sørensen', handle: 'ada', bio: 'Contour lines enthusiast' },
  { did: BO, firstName: 'Bo', lastName: 'Whitfield', handle: 'bo', bio: 'Mostly here for the projections' },
  { did: CY, firstName: 'Cy', lastName: 'Mendez', handle: 'cy', bio: 'Surveyor' },
  { did: DEE, firstName: 'Dee', lastName: 'Okonkwo', handle: 'dee', bio: 'Archivist' },
];

/** Signal types the fixtures reuse. A community defines what a reaction means; these are examples. */
export const LIKE = { name: 'Like', slug: 'like', icon: 'heart', semantic: 'like', description: 'Appreciation' };
export const BOOST = { name: 'Boost', slug: 'boost', icon: 'rocket', description: 'Worth passing on' };
