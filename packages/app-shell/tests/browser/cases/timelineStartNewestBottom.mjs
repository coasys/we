/** The same check as `timelineReadings`, for another of the four readings. */
import { checkReading } from './timelineReadings.mjs';

export const name = 'a timeline read from the start, newest-at-bottom, opens at the top, with more below';
export const scenario = 'timeline:start-newest-bottom';
export const widths = [420];

export async function check(api) {
  return checkReading(api, { anchor: 'top', more: 'end' });
}
