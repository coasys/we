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
 * - A screen that shows a secret on purpose (the words screen) is not kept as an artefact: the
 *   runner withholds its screenshot and text. Every other screen is kept and scanned.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';

import type { ScanFinding, SecretKind } from './types.ts';

interface Entry {
  kind: SecretKind;
  label: string;
  forms: Buffer[];
  /** For the 12 words: each word, which `redact` replaces on its own. */
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
   * Records the 12 words: as one phrase, one per line, and as a JSON list. A single word is not
   * searched for: it is an ordinary English word and would match by chance.
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
          const offset = firstMatch(content, entry.forms);
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
