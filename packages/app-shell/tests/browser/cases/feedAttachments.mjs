/**
 * A message sent with two files, in the space's Feed.
 *
 * - The words of the message are drawn, and the line with no files beside it.
 * - Each file is named and sized under the words, with a button to save it.
 * - The line with no files offers no file to save.
 */
import { checkAttachments } from './feedCallAttachments.mjs';

export const name = 'a message with files in the Feed';
export const scenario = 'feed:attachments';
export const widths = [560];

export async function check(page) {
  return checkAttachments(page, 'feed-attachments');
}
