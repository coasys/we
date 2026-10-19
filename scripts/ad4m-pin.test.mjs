/**
 * The pin reader's contract: it reads the two forms a pin may take, and refuses everything else
 * rather than guessing. Every workflow that builds an executor, gates a merge or labels a preview
 * reads the pin through it, so one that quietly misread a pin would build, test and admit the wrong
 * ad4m everywhere at once.
 *
 * `node:test` rather than vitest: this is root tooling and the root has no test runner. The merge
 * gate runs these where it uses the reader.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { lockfileSnapshots, PACKAGES, parsePin, PinError, snapshotUrl, withIntegrity } from './ad4m-pin.mjs';

const SHA = 'ee40d1143a72650039e6e847810f6e795320e58c';
const OTHER = '2343daaeac8d62f1e8ad7e975a77c85c281c2876';
const both = (sdk, connect = sdk) => ({ [PACKAGES[0]]: sdk, [PACKAGES[1]]: connect });
const snapshots = (sdk, connect = sdk) => both(snapshotUrl(PACKAGES[0], sdk), snapshotUrl(PACKAGES[1], connect));

describe('what the pin reads as', () => {
  it('a version', () => {
    assert.deepEqual(parsePin(both('0.13.1-staging.2')), { kind: 'version', version: '0.13.1-staging.2' });
  });

  it('a release version', () => {
    assert.deepEqual(parsePin(both('0.14.0')), { kind: 'version', version: '0.14.0' });
  });

  it('a snapshot, by its full commit', () => {
    assert.deepEqual(parsePin(snapshots(SHA)), { kind: 'snapshot', commit: SHA });
  });
});

describe('what the pin refuses', () => {
  const refuses = (overrides, pattern) =>
    assert.throws(
      () => parsePin(overrides),
      (e) => e instanceof PinError && pattern.test(e.message),
    );

  it('a short sha, naming the command that expands it', () => {
    refuses(snapshots(SHA.slice(0, 9)), /short sha.*pnpm bump:ad4m ee40d1143/);
  });

  it('core and connect from different commits', () => {
    refuses(snapshots(SHA, OTHER), /different ad4m commits/);
  });

  it('core and connect at different versions', () => {
    refuses(both('0.13.1-staging.2', '0.13.1-staging.1'), /Pin both to one version/);
  });

  it('one by version and the other by snapshot', () => {
    refuses(both('0.13.1-staging.2', snapshotUrl(PACKAGES[1], SHA)), /by version and .* by snapshot/);
  });

  for (const [name, spec] of [
    ['another host', `https://example.com/coasys/ad4m/@coasys/ad4m@${SHA}`],
    ['another repository', `https://pkg.pr.new/someone/ad4m/@coasys/ad4m@${SHA}`],
    ['the wrong package in the URL', snapshotUrl(PACKAGES[1], SHA)],
    ['a pull request number instead of a commit', 'https://pkg.pr.new/coasys/ad4m/@coasys/ad4m@1427'],
    ['a range', '^0.13.0'],
    ['a tag', 'next'],
    ['a local link', 'link:../ad4m/core'],
  ]) {
    it(name, () => refuses(both(spec, snapshotUrl(PACKAGES[1], SHA)), /neither an npm version nor|by .* and .* by/));
  }

  it('a missing override', () => {
    refuses({ [PACKAGES[0]]: '0.13.1-staging.2' }, /has no override/);
  });
});

describe('integrity in the lockfile', () => {
  const sdk = snapshotUrl(PACKAGES[0], SHA);
  const connect = snapshotUrl(PACKAGES[1], SHA);
  const lockfile = [
    'packages:',
    '',
    `  '@coasys/ad4m@${sdk}':`,
    `    resolution: {tarball: ${sdk}}`,
    '    version: 0.13.1-staging.2',
    '',
    `  '@coasys/ad4m-connect@${connect}':`,
    `    resolution: {tarball: ${connect}}`,
    '    version: 0.13.1-staging.2',
    '',
    '  zod@3.23.8:',
    '    resolution: {integrity: sha512-zod}',
    '',
  ].join('\n');

  it('finds each snapshot, and that neither has integrity yet', () => {
    assert.deepEqual(lockfileSnapshots(lockfile), [
      { tarball: sdk, integrity: undefined },
      { tarball: connect, integrity: undefined },
    ]);
  });

  it('writes integrity into the resolution, and nothing else', () => {
    const written = withIntegrity(lockfile, { [sdk]: 'sha512-core', [connect]: 'sha512-connect' });
    assert.match(
      written,
      new RegExp(`resolution: \\{integrity: sha512-core, tarball: ${sdk.replace(/[.@/]/g, '\\$&')}\\}`),
    );
    assert.deepEqual(
      lockfileSnapshots(written).map((s) => s.integrity),
      ['sha512-core', 'sha512-connect'],
    );
    assert.equal(written.split('\n').length, lockfile.split('\n').length);
    assert.match(written, /resolution: \{integrity: sha512-zod\}/);
  });

  it('leaves a tarball it has no integrity for alone', () => {
    assert.equal(withIntegrity(lockfile, { [sdk]: 'sha512-core' }).includes(`{tarball: ${connect}}`), true);
  });
});
