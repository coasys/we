/**
 * A recorded call's card in the Cards view, on a call that holds one heard line and one typed message.
 *
 * - The card counts two utterances: the heard line and the message. It does not count the message's
 *   own `TextBlock` as a third.
 * - The opened transcript shows each line once, the heard line first.
 */
import { checkLines } from './typedAndHeardTranscript.mjs';

export const name = 'a call card counts and shows heard lines and typed messages, once each';
export const scenario = 'calls:typed-and-heard-list';
export const widths = [900];

export async function check(page) {
  return checkLines(page, 'typed-and-heard-calls-list', '2 utterances');
}
