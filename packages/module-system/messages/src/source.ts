/**
 * How a line arrived, as a message records it in `source`: heard and transcribed, typed, or heard and
 * then corrected by somebody. A line WE did not write — a bot's — carries none.
 *
 * Shared because it is what a message *is*, not what one module does with it: the transcript writes
 * spoken and corrected lines, the Feed and the transcript both write typed ones, and both draw the
 * difference.
 */
export const SPOKEN = 'spoken';
export const TYPED = 'typed';
export const CORRECTED = 'corrected';

/** What editing a line does to how it arrived: a heard line becomes corrected, anything else stays. */
export const sourceAfterEdit = (was: string | undefined): string | undefined =>
  was === SPOKEN ? CORRECTED : undefined;
