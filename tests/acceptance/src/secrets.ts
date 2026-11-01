/**
 * The secret ledger and the scanner.
 *
 * Every secret a scenario sees goes into the ledger: the 12 words, a passphrase, an offer link, a
 * password, a test marker. After the scenario, the scanner reads every log, data folder, stored
 * file and report artefact the scenario touched, and looks for each secret in each form it could
 * be written in. A finding fails the scenario, unless the allow list names the place, with the
 * requirement that allows it there.
 *
 * Two places are apart:
 *
 * - The SPARQL store directories of an executor (`perspectives/<uuid>/sparql_store/`) keep links
 *   plain by design. A secret found there is listed under `apart` and does not fail the scenario.
 * - A screen that shows a secret on purpose (the words screen, the offer link) is not kept as an
 *   artefact: the runner withholds the screenshot and the text of a step that declares `shows`.
 *   Every other screen is kept and scanned.
 *
 * What the scan reads is bytes: logs, data folders and window text. It cannot read a screenshot,
 * which is pixels. A screenshot is kept only for a step that does not declare `shows`, so a step
 * that ends on a screen with a secret on it must declare `shows` (`test/rules.test.ts` checks this
 * for the screens it knows).
 *
 * The 12 words are found as a run of words in a text, whatever separates them: a screen lists them
 * with their numbers between them, a log with spaces, a file one per line. See `wordRun`.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';

import type { ScanFinding, SecretKind } from './types.ts';

interface Entry {
  kind: SecretKind;
  label: string;
  forms: Buffer[];
  /** For the 12 words: each word, which `redact` replaces on its own and `wordRun` looks for in order. */
  words?: string[];
}

/** A place where a secret may be found, and the requirement that allows it there. */
export interface Allowance {
  /** The ledger label the allowance is for. */
  label: string;
  /** Matched against the path of the file. */
  where: RegExp;
  /** The requirement that allows it, for the report. */
  because: string;
}

export interface ScanResult {
  findings: ScanFinding[];
  /** Findings in the SPARQL stores, which keep links plain by design. */
  apart: ScanFinding[];
  /** Findings the allow list accepts, with the reason. */
  allowed: (ScanFinding & { because: string })[];
  files: number;
  bytes: number;
}

/** The shortest secret the ledger takes: a shorter one would match by chance. */
const MIN_LENGTH = 8;

/**
 * How many words of the phrase, next to each other and in the phrase's order, a text must hold for
 * the scan to call it a leak of the words. A single word stays allowed: it is an ordinary English
 * word, and the check-words screen asks for two by number. Four is past anything chance writes:
 * between the four a match allows only characters that are not letters (numbers, spaces,
 * punctuation, newlines), so English prose, which has other words between any four of these,
 * never matches; and the four must be the phrase's own, in its order — one of 2048^4 (about
 * 1.8 × 10^13) sequences of list words. Four words are also already a leak worth failing on: 44 of
 * the phrase's 128 bits.
 */
export const WORD_RUN = 4;

/**
 * Where a text holds `WORD_RUN` or more of the phrase's words in a row, in the phrase's order, with
 * nothing but characters that are not letters between them; or -1. The whole phrase joined by any
 * whitespace, numbers or punctuation is such a run. The text is read one byte to a character
 * (latin1), so the answer is a byte offset and a binary file reads without error. A word is a run
 * of ASCII letters, as every word of the English list is: a byte of a character outside ASCII (the
 * `·` or `—` a screen puts between things) separates words rather than joining them. Case is
 * ignored, since a screen may show them in capitals.
 */
export function wordRun(content: Buffer, words: string[]): number {
  const phrase = words.map((w) => w.toLowerCase());
  // The places in the phrase the run so far could end at: more than one when a word repeats.
  let ends: number[] = [];
  let length = 0;
  let start = -1;
  for (const token of content.toString('latin1').matchAll(/[A-Za-z]+/g)) {
    const word = token[0].toLowerCase();
    const next = ends.map((i) => i + 1).filter((i) => phrase[i] === word);
    if (next.length) {
      ends = next;
      length += 1;
    } else {
      ends = phrase.flatMap((w, i) => (w === word ? [i] : []));
      length = ends.length ? 1 : 0;
      start = token.index;
    }
    if (length >= WORD_RUN) return start;
  }
  return -1;
}

/** Every form a string can be written in that a careless log line or file would use. */
function formsOf(value: string): Buffer[] {
  const raw = Buffer.from(value, 'utf8');
  const forms = [raw, Buffer.from(raw.toString('base64')), Buffer.from(raw.toString('hex'))];
  // The JSON string form differs from the raw one only when the value has characters JSON escapes.
  const json = JSON.stringify(value).slice(1, -1);
  if (json !== value) forms.push(Buffer.from(json, 'utf8'));
  return forms;
}

const SPARQL_STORE = new RegExp(
  `${escapeRegExp(sep)}perspectives${escapeRegExp(sep)}[^${escapeRegExp(sep)}]+${escapeRegExp(sep)}sparql_store(${escapeRegExp(sep)}|$)`,
);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class SecretLedger {
  private readonly entries: Entry[] = [];

  /** Records one secret. */
  add(kind: SecretKind, label: string, value: string): void {
    if (value.length < MIN_LENGTH) {
      throw new Error(`the secret "${label}" is shorter than ${MIN_LENGTH} characters, so a scan of it means nothing`);
    }
    this.entries.push({ kind, label, forms: formsOf(value) });
  }

  /**
   * Records the 12 words: as one phrase, one per line, and as a JSON list, and as a run of
   * `WORD_RUN` of them in order with anything but letters between them (`wordRun`), which is how a
   * screen's text lists them. A single word is not searched for: it is an ordinary English word and
   * would match by chance.
   */
  addWords(label: string, words: string[]): void {
    const phrase = words.join(' ');
    const forms = [
      ...formsOf(phrase),
      Buffer.from(words.join('\n'), 'utf8'),
      Buffer.from(JSON.stringify(words), 'utf8'),
      Buffer.from(words.map((w) => JSON.stringify(w)).join(', '), 'utf8'),
    ];
    this.entries.push({ kind: 'words', label, forms, words });
  }

  /**
   * The text with every recorded secret replaced by its label: for what is published rather than
   * scanned, as a failure in the report, a console line or an issue. The 12 words are replaced word
   * by word too, since a screen lists them apart, with their numbers between them.
   */
  redact(text: string): string {
    let out = text;
    for (const entry of this.entries) {
      const mark = `[${entry.label}]`;
      // Longest form first, so that a form inside another does not leave the rest of it behind.
      const forms = entry.forms.map((f) => f.toString('utf8')).sort((a, b) => b.length - a.length);
      for (const form of forms) out = out.split(form).join(mark);
      for (const word of entry.words ?? []) {
        out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'giu'), mark);
      }
    }
    return out;
  }

  /** The labels recorded so far, for the report. */
  labels(): { kind: SecretKind; label: string }[] {
    return this.entries.map(({ kind, label }) => ({ kind, label }));
  }

  /** Searches every file under each path for every recorded secret. */
  async scan(paths: string[], allow: Allowance[] = []): Promise<ScanResult> {
    const result: ScanResult = { findings: [], apart: [], allowed: [], files: 0, bytes: 0 };
    const seen = new Set<string>();
    for (const path of paths) {
      for await (const file of walk(path)) {
        if (seen.has(file)) continue;
        seen.add(file);
        let content: Buffer;
        try {
          content = await readFile(file);
        } catch {
          continue; // Gone between the listing and the read: a lock file, a socket.
        }
        result.files += 1;
        result.bytes += content.length;
        for (const entry of this.entries) {
          const offset = earliest(firstMatch(content, entry.forms), entry.words ? wordRun(content, entry.words) : -1);
          if (offset < 0) continue;
          const finding: ScanFinding = { label: entry.label, kind: entry.kind, where: file, offset };
          const allowance = allow.find((a) => a.label === entry.label && a.where.test(file));
          if (allowance) result.allowed.push({ ...finding, because: allowance.because });
          else if (SPARQL_STORE.test(file)) result.apart.push(finding);
          else result.findings.push(finding);
        }
      }
    }
    return result;
  }
}

/** The earlier of two offsets, either of which may be -1 for none. */
function earliest(a: number, b: number): number {
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}

function firstMatch(content: Buffer, forms: Buffer[]): number {
  let first = -1;
  for (const form of forms) {
    const at = content.indexOf(form);
    if (at >= 0 && (first < 0 || at < first)) first = at;
  }
  return first;
}

/** Every regular file under a path, or the path itself when it is a file. Symbolic links are not followed. */
async function* walk(path: string): AsyncGenerator<string> {
  let info;
  try {
    info = await stat(path);
  } catch {
    return;
  }
  if (info.isFile()) {
    yield path;
    return;
  }
  if (!info.isDirectory()) return;
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) yield* walk(child);
    else if (entry.isFile()) yield child;
  }
}
