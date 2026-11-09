/**
 * The words the window is given when its executor does not run (`executor-state`'s `reason`).
 *
 * None of them holds a path. The window can be seen by somebody else, on a shared screen or in a
 * screenshot, and a path names the account and the person. A folder is named by what it is ("this
 * account's data folder"), never by where it is.
 */
import { EXIT } from './executorProcess.js';

/** Why the executor stopped for good, by the supervisor's verdict. */
export function stoppedWords(action) {
  if (action === 'refused')
    return "The executor refused its settings. Fix the config file (executor-config.json) in this account's data folder, then try again.";
  if (action === 'busy')
    return "Another AD4M executor is using this account's data folder. Quit the app that runs it (the ADAM launcher, another copy of this app), then try again.";
  return 'The executor kept stopping, so the app does not start it again on its own.';
}

export const LOG_WORDS = "Its log is logs/executor-0.log in this account's data folder.";

/*
  A system error (a failed `mkdir`, a write to a read-only disk) carries the path it failed on in its
  message: `ENOTDIR: not a directory, mkdir '/home/…'`. Its code says enough, so the words are made
  from the code. Any other message is kept, with every path in it replaced: an error from a library
  can name a file too.
*/
const SYSTEM_WORDS = {
  EACCES: 'the app may not write to it',
  EPERM: 'the app may not write to it',
  EROFS: 'it is on a disk that cannot be written to',
  ENOSPC: 'the disk is full',
  ENOTDIR: 'a file is where a folder must be',
  EEXIST: 'a file is where a folder must be',
  ENOENT: 'a part of it is missing',
  ENAMETOOLONG: 'its location is too long',
};

/** An absolute path (POSIX, Windows, or `~`), quoted or not: one that starts a word, so "and/or" is kept. */
const PATH = /(?<=^|[\s'"`(=])(?:[A-Za-z]:[\\/]|\\\\|~?\/)[^\s'"`,;:)]+/g;

/** Why a start failed, in words for the window. `logged` adds where its log is. */
export function startFailureWords(err, { logged = false } = {}) {
  const verdict = { [EXIT.CONFIG_REFUSED]: 'refused', [EXIT.DATA_FOLDER_BUSY]: 'busy' }[err?.exitCode];
  let reason;
  if (verdict) reason = stoppedWords(verdict);
  else if (typeof err?.code === 'string' && typeof err?.syscall === 'string')
    reason = `The app could not use this account's data folder: ${SYSTEM_WORDS[err.code] ?? 'the system refused'} (${err.code}).`;
  else reason = String(err?.message || err || 'The executor did not start.').replace(PATH, '(a path)');
  return logged ? `${sentence(reason)}\n\n${LOG_WORDS}` : reason;
}

/**
 * `words` ending as a sentence does. The window draws a reason as one paragraph, so the break before
 * the next sentence reads as a space, and a reason with no stop ran on into it.
 */
function sentence(words) {
  const trimmed = words.trimEnd();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
