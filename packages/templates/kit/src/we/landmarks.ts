/**
 * The records a space names as its landmarks — its canvas, its board — read as records.
 *
 * A landmark is a `SpaceLandmark` record naming one record (`node`) by a name (`name`). A template
 * reads them with a query, binds it once where its screen starts, and looks a name up in the rows:
 * the same answer on every host, since it is the space's own records rather than something a host
 * keeps beside them.
 *
 * The rows are a vocabulary — a space writes one per landmark, at creation or when somebody makes
 * the record later — so the query reads them whole. Identical questions share one subscription in
 * the renderer, so a screen binding this in its route and in a panel asks the backend once.
 */
import type { QueryToken } from '@we/schema-shared';

/** The local name the landmark rows are bound under. */
export const LANDMARKS = 'spaceLandmarks';

/** A `$queries` entry binding the space's landmark rows as `local.spaceLandmarks`. */
export const landmarksQuery = (): Record<string, QueryToken['$query']> => ({
  [LANDMARKS]: { entity: 'SpaceLandmark' },
});

/** The landmarks have answered: until then an absent landmark is "not known yet", not "none". */
export const LANDMARKS_LOADED = `local.${LANDMARKS}Loaded`;

/**
 * The id of the record a landmark names, as an expression — no value where the space names none.
 *
 * Two landmarks of one name (two members making the space's board at the same moment) resolve to
 * the newest, as everywhere else that reads them.
 */
export const landmark = (name: string): string =>
  `find(sortBy(local.${LANDMARKS}, 'createdAt', 'desc'), { name: '${name}' }).node`;
