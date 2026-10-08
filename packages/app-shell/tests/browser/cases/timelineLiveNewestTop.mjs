/** The same check as `timelineReadings`, for another of the four readings. */
import { checkReading } from './timelineReadings.mjs';

export const name = 'a live timeline drawn newest-at-top opens at the top, with more below';
export const scenario = 'timeline:live-newest-top';
export const widths = [420];

export async function check(api) {
  return checkReading(api, { anchor: 'top', more: 'end' });
}
