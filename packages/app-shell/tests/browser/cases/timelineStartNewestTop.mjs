/** The same check as `timelineReadings`, for another of the four readings. */
import { checkReading } from './timelineReadings.mjs';

export const name = 'a timeline read from the start, newest-at-top, opens at the bottom, with more above';
export const scenario = 'timeline:start-newest-top';
export const widths = [420];

export async function check(api) {
  return checkReading(api, { anchor: 'bottom', more: 'start' });
}
