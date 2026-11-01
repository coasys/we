import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SecretLedger, WORD_RUN, wordRun } from '../src/secrets.ts';

const WORDS = [
  'member',
  'tenant',
  'urban',
  'tray',
  'rebel',
  'arrive',
  'hill',
  'review',
  'forest',
  'rifle',
  'close',
  'pear',
];

function folder(files: Record<string, string | Buffer>): string {
  const dir = mkdtempSync(join(tmpdir(), 'acceptance-scan-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

describe('the secret ledger and its scanner', () => {
  it('finds a secret in each form a log or a file would hold it', async () => {
    const passphrase = 'a long passphrase for the run';
    const raw = Buffer.from(passphrase).toString('base64');
    const hex = Buffer.from(passphrase).toString('hex');
    const dir = folder({
      'plain.log': `unlock with ${passphrase}\n`,
      'b64.json': JSON.stringify({ p: raw }),
      'hex.txt': `0x${hex}`,
      'clean.log': 'nothing here',
    });
    const ledger = new SecretLedger();
    ledger.add('passphrase', 'the passphrase', passphrase);
    const scan = await ledger.scan([dir]);
    expect(scan.findings.map((f) => f.where.slice(dir.length + 1)).sort()).toEqual([
      'b64.json',
      'hex.txt',
      'plain.log',
    ]);
    expect(scan.files).toBe(4);
    expect(scan.findings.find((f) => f.where.endsWith('plain.log'))?.offset).toBe('unlock with '.length);
  });

  it('finds the 12 words as a phrase, one per line or as a list, and never a single word', async () => {
    const dir = folder({
      'phrase.log': WORDS.join(' '),
      'lines.txt': WORDS.join('\n'),
      'list.json': JSON.stringify({ words: WORDS }),
      'one-word.txt': 'the forest is quiet',
    });
    const ledger = new SecretLedger();
    ledger.addWords('the 12 words', WORDS);
    const scan = await ledger.scan([dir]);
    expect(scan.findings.map((f) => f.where.slice(dir.length + 1)).sort()).toEqual([
      'lines.txt',
      'list.json',
      'phrase.log',
    ]);
  });

  it('finds the 12 words in window text that lists them with their numbers between them', async () => {
    // The words screen as the window text gives it: each number on its line, then its word.
    const screen = `Your 12 words\n${WORDS.map((w, i) => `${i + 1}\n${w}`).join('\n')}\nI understand`;
    const dir = folder({
      'step.txt': `── a · identity ──\n${screen}`,
      'spaced.log': `words: 1. ${WORDS.slice(0, 6).join(' 2) ')}`,
      'caps.txt': WORDS.slice(3, 7).join(' · ').toUpperCase(),
    });
    const ledger = new SecretLedger();
    ledger.addWords('the 12 words', WORDS);
    const scan = await ledger.scan([dir]);
    expect(scan.findings.map((f) => f.where.slice(dir.length + 1)).sort()).toEqual([
      'caps.txt',
      'spaced.log',
      'step.txt',
    ]);
    const step = scan.findings.find((f) => f.where.endsWith('step.txt'));
    expect(step?.offset).toBe(Buffer.byteLength(`── a · identity ──\nYour 12 words\n1\n`));
  });

  it(`finds ${WORD_RUN} words of the phrase in order, and not fewer, other orders or parts of words`, async () => {
    const dir = folder({
      'four.txt': `x ${WORDS.slice(5, 5 + WORD_RUN).join('\n')} y`,
      'three.txt': WORDS.slice(5, 5 + WORD_RUN - 1).join(' '),
      'two-asked.txt': `Word 3\n${WORDS[2]}\nWord 9\n${WORDS[8]}`,
      'reordered.txt': [WORDS[0], WORDS[2], WORDS[1], WORDS[3], WORDS[5]].join(' '),
      'prose.txt': `the ${WORDS[0]} and ${WORDS[1]} of the ${WORDS[2]} ${WORDS[3]}`,
      'longer.txt': ['remember', ...WORDS.slice(1, 4)].join(' '),
    });
    const ledger = new SecretLedger();
    ledger.addWords('the 12 words', WORDS);
    const scan = await ledger.scan([dir]);
    expect(scan.findings.map((f) => f.where.slice(dir.length + 1))).toEqual(['four.txt']);
    expect(scan.findings[0].offset).toBe(2);
  });

  it('follows a run through a word the phrase holds twice', () => {
    const words = ['tray', 'rebel', 'tray', 'arrive', 'hill', 'review', ...WORDS.slice(6)];
    expect(wordRun(Buffer.from('tray rebel tray arrive'), words)).toBe(0);
    expect(wordRun(Buffer.from('rebel tray arrive hill'), words)).toBe(0);
    expect(wordRun(Buffer.from('tray arrive hill review'), words)).toBe(0);
  });

  it('lists a secret in a SPARQL store apart, where links are plain by design, without failing', async () => {
    const marker = 'marker-7f3a9c1e5b';
    const dir = folder({
      'ad4m/perspectives/1234-uuid/sparql_store/data.db': `<${marker}>`,
      'ad4m/perspectives/1234-uuid/other.db': marker,
    });
    const ledger = new SecretLedger();
    ledger.add('marker', 'a test marker', marker);
    const scan = await ledger.scan([dir]);
    expect(scan.apart.map((f) => f.where)).toEqual([join(dir, 'ad4m/perspectives/1234-uuid/sparql_store/data.db')]);
    expect(scan.findings.map((f) => f.where)).toEqual([join(dir, 'ad4m/perspectives/1234-uuid/other.db')]);
  });

  it('accepts a finding the allow list names, with its reason', async () => {
    const offer = 'coasys:offer:1:abcdefghijklmnop';
    const dir = folder({ 'claim.log': offer, 'other.log': offer });
    const ledger = new SecretLedger();
    ledger.add('offer-secret', 'the offer', offer);
    const scan = await ledger.scan(
      [dir],
      [{ label: 'the offer', where: /claim\.log$/, because: 'the claim prints what it was given' }],
    );
    expect(scan.allowed).toHaveLength(1);
    expect(scan.allowed[0].because).toBe('the claim prints what it was given');
    expect(scan.findings.map((f) => f.where)).toEqual([join(dir, 'other.log')]);
  });

  it('refuses a secret too short to scan for', () => {
    expect(() => new SecretLedger().add('password', 'short', 'abc')).toThrow(/shorter than/);
  });

  it('reads a path given twice once, and a missing path as nothing', async () => {
    const dir = folder({ 'a.log': 'x' });
    const ledger = new SecretLedger();
    ledger.add('marker', 'm', 'marker-0000000');
    const scan = await ledger.scan([dir, dir, join(dir, 'gone')]);
    expect(scan.files).toBe(1);
  });

  it('redacts each form of a secret, and the 12 words only as whole words', () => {
    const ledger = new SecretLedger();
    ledger.add('passphrase', 'the passphrase', 'a long "quoted" passphrase');
    ledger.addWords('the 12 words', WORDS);
    const json = JSON.stringify({ p: 'a long "quoted" passphrase' });
    const b64 = Buffer.from('a long "quoted" passphrase').toString('base64');
    expect(ledger.redact(`${json} ${b64}`)).toBe('{"p":"[the passphrase]"} [the passphrase]');
    expect(ledger.redact('1\nmember\n2\nTenant')).toBe('1\n[the 12 words]\n2\n[the 12 words]');
    // Part of a longer word is not one of the words.
    expect(ledger.redact('remember the pearl, no closer')).toBe('remember the pearl, no closer');
  });
});
