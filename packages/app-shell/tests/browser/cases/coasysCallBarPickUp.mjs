/**
 * The way back into an ended call, in the call page's bar: Pick it back up, immediately left of the
 * Interpretation button and the transcript download.
 */
import { wayIn } from './coasysCallBarWayIn.mjs';

export const name = "an ended call's bar: Pick it back up, left of the transcript";
export const scenario = 'coasys:call-bar-ended';
export const widths = [900];

export const check = (api) => wayIn(api, 'coasys-call-bar-ended', 'Pick it back up', ['Interpretation', 'export']);
