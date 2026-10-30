import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SecretLedger } from '../src/secrets.ts';

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
