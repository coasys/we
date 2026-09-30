/**
 * The executor log's rotation and filtering, against a real temp directory.
 *
 * Rotation is the part worth pinning: it only ever runs once per start, so a mistake in it shows up
 * as the one run somebody needed being the one that is missing.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAnsiStripper, logFileName, openExecutorLog, rotateLogs } from './executorLog.js';

let dir;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'we-executor-log-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const read = (index) => readFileSync(join(dir, logFileName(index)), 'utf8');

describe('logFileName', () => {
  it('names the current run ad4m.log and older ones with the index before the extension', () => {
    expect(logFileName(0)).toBe('ad4m.log');
    expect(logFileName(3)).toBe('ad4m.3.log');
  });
});

describe('rotation', () => {
  it('shifts each run down one place', () => {
    writeFileSync(join(dir, 'ad4m.log'), 'newest');
    writeFileSync(join(dir, 'ad4m.1.log'), 'older');

    rotateLogs(dir, 5);

    expect(existsSync(join(dir, 'ad4m.log'))).toBe(false);
    expect(read(1)).toBe('newest');
    expect(read(2)).toBe('older');
  });

  it('keeps the current run plus four, dropping the oldest', () => {
    for (let run = 1; run <= 7; run++) {
      const log = openExecutorLog(dir);
      log.write(`run ${run}`);
      log.close();
    }

    expect(readdirSync(dir).sort()).toEqual(['ad4m.1.log', 'ad4m.2.log', 'ad4m.3.log', 'ad4m.4.log', 'ad4m.log']);
    expect(read(0)).toBe('run 7');
    expect(read(4)).toBe('run 3');
  });

  it('does nothing to an empty directory', () => {
    rotateLogs(dir, 5);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('openExecutorLog', () => {
  it('creates the data directory when it does not exist yet', () => {
    const nested = join(dir, 'we-accounts', 'fresh');
    const log = openExecutorLog(nested);
    log.write('hello');
    log.close();

    expect(readFileSync(join(nested, 'ad4m.log'), 'utf8')).toBe('hello');
  });

  it('returns null and reports when the file cannot be opened', () => {
    const blocker = join(dir, 'not-a-directory');
    writeFileSync(blocker, '');
    const errors = [];

    expect(openExecutorLog(join(blocker, 'data'), { onError: (message) => errors.push(message) })).toBeNull();
    expect(errors).toHaveLength(1);
  });

  it('marks lines from this process apart from executor output', () => {
    const log = openExecutorLog(dir);
    log.write('[2026-09-15T10:00:00Z INFO  rust_executor] started\n');
    log.host('log', 'Executor exited — code: %d', 1);
    log.host('warn', 'Could not remove socket');
    log.close();

    expect(read(0)).toMatch(
      /started\n\[[\d\-T:.]+Z HOST\] Executor exited — code: 1\n\[[\d\-T:.]+Z HOST WARN\] Could not remove socket\n$/,
    );
  });

  it('stops at the size limit and says so once', () => {
    const log = openExecutorLog(dir, { maxBytes: 10 });
    log.write('12345');
    log.write('67890');
    log.write('this does not fit');
    log.write('nor this');
    log.close();

    const contents = read(0);
    expect(contents.startsWith('1234567890\n')).toBe(true);
    expect(contents.match(/size limit/g)).toHaveLength(1);
    expect(contents).not.toContain('fit');
  });

  it('ignores writes after close', () => {
    const log = openExecutorLog(dir);
    log.close();
    log.write('late output from a killed process');
    expect(read(0)).toBe('');
  });
});

describe('createAnsiStripper', () => {
  const text = (strip, ...chunks) => Buffer.concat(chunks.map((chunk) => strip(Buffer.from(chunk)))).toString('utf8');

  it('removes colour codes', () => {
    expect(text(createAnsiStripper(), '\x1b[32mINFO\x1b[0m \x1b[1;2mdimmed\x1b[0m')).toBe('INFO dimmed');
  });

  it('carries a sequence split across chunks', () => {
    expect(text(createAnsiStripper(), 'a\x1b', '[3', '1mb\x1b[0', 'mc')).toBe('abc');
  });

  it('leaves multi-byte characters intact across a chunk boundary', () => {
    const bytes = Buffer.from('— ok');
    const strip = createAnsiStripper();
    expect(Buffer.concat([strip(bytes.subarray(0, 1)), strip(bytes.subarray(1))]).toString('utf8')).toBe('— ok');
  });
});
