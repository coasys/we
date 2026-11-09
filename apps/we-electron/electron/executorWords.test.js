/**
 * The words the window is given when its executor does not run: why, and never where. A path in them
 * would name the account on a shared screen.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { EXIT } from './executorProcess.js';
import { LOG_WORDS, startFailureWords, stoppedWords } from './executorWords.js';

const root = mkdtempSync(join(tmpdir(), 'we-words-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** The error Node throws for a data folder that a file stands in the place of. */
function notADirectory() {
  const file = join(root, 'data');
  writeFileSync(file, '');
  try {
    mkdirSync(join(file, 'inside'), { recursive: true });
  } catch (err) {
    return err;
  }
  throw new Error('mkdir under a file succeeded');
}

describe('startFailureWords', () => {
  it("says what the supervisor's verdict was for an executor that refused or found its folder busy", () => {
    expect(startFailureWords(Object.assign(new Error('x'), { exitCode: EXIT.CONFIG_REFUSED }))).toBe(
      stoppedWords('refused'),
    );
    expect(startFailureWords(Object.assign(new Error('x'), { exitCode: EXIT.DATA_FOLDER_BUSY }))).toBe(
      stoppedWords('busy'),
    );
  });

  it('makes the words from the code of a system error, never from its message, which names the path', () => {
    const err = notADirectory();
    expect(err.message).toContain(root);
    const words = startFailureWords(err);
    expect(words).not.toContain(root);
    expect(words).toBe("The app could not use this account's data folder: a file is where a folder must be (ENOTDIR).");
  });

  it('says the system refused for a code it has no words for', () => {
    const err = Object.assign(new Error(`EIO: i/o error, open '${root}/x'`), { code: 'EIO', syscall: 'open' });
    expect(startFailureWords(err)).toBe("The app could not use this account's data folder: the system refused (EIO).");
  });

  it('keeps any other message, with every path in it replaced', () => {
    expect(startFailureWords(new Error('GraphQL server on port 12001 not ready after 60 s'))).toBe(
      'GraphQL server on port 12001 not ready after 60 s',
    );
    expect(startFailureWords(new Error(`no executor at ${root}/ad4m-executor, or at '~/bin/x'`))).toBe(
      "no executor at (a path), or at '(a path)'",
    );
    expect(startFailureWords(new Error('C:\\Users\\Test\\data is locked'))).toBe('(a path) is locked');
    expect(startFailureWords(new Error('read and/or write failed'))).toBe('read and/or write failed');
  });

  it('has words for a failure with no message', () => {
    expect(startFailureWords(undefined)).toBe('The executor did not start.');
  });

  it("adds where the log is when this start's log is open", () => {
    expect(startFailureWords(new Error('it stopped.'), { logged: true })).toBe(`it stopped.\n\n${LOG_WORDS}`);
  });

  /*
    The window draws the reason as one paragraph, so the break before the log's sentence reads as a
    space: a reason with no full stop ran on into it ("…before it was ready Its log is…").
  */
  it('ends the reason with a full stop before the log sentence', () => {
    expect(startFailureWords(new Error('The executor exited before it was ready'), { logged: true })).toBe(
      `The executor exited before it was ready.\n\n${LOG_WORDS}`,
    );
    expect(startFailureWords(new Error('Is it running?'), { logged: true })).toBe(`Is it running?\n\n${LOG_WORDS}`);
    expect(startFailureWords(new Error('it stopped:\n\nlast line'), { logged: true })).toBe(
      `it stopped:\n\nlast line.\n\n${LOG_WORDS}`,
    );
  });
});
