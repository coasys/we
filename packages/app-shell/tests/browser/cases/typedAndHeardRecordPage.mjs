/**
 * A call's own record page, on a call that holds one heard line and one typed message.
 *
 * - The page counts two utterances: the heard line and the message. It does not count the message's
 *   own `TextBlock` as a third.
 * - The transcript shows each line once, the heard line first.
 */
import { checkLines } from './typedAndHeardTranscript.mjs';

export const name = 'a call page counts and shows heard lines and typed messages, once each';
export const scenario = 'calls:typed-and-heard-record';
export const widths = [900];

export async function check(page) {
  return checkLines(page, 'typed-and-heard-record-page', '2 utterances');
}
