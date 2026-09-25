#!/usr/bin/env node
// Register the `we-generated` merge driver that `.gitattributes` asks for.
//
// A merge driver cannot live in the repository the way `.gitattributes` can — git deliberately
// refuses to run a command a fetched branch could have supplied, so the driver has to be registered
// in the clone's own config. `pnpm prepare` runs this, which is the same hook husky uses.
//
// The driver takes the current branch's copy and exits clean. That is the right answer for these
// six files and only these six: they are written wholesale by `generate-context`, so neither side of
// a conflict is more correct than the other and the real resolution is to regenerate. CI is the
// backstop — the Build job regenerates and fails if the tree is dirty — so a merge that leaves them
// stale is caught before review.
//
// Run directly to re-register: node scripts/install-merge-driver.mjs

import { execFileSync } from 'node:child_process';

const settings = [
  ['merge.we-generated.name', 'Keep one side of a generated AI-context file; regenerate afterwards'],
  // `true` is git's built-in "always succeeds, leaves %A in place" driver. %A is the current
  // branch's version, already written by git before the driver runs.
  ['merge.we-generated.driver', 'true'],
  // Never ask for a manual three-way on these. Without it a `git merge` with conflict style
  // `diff3` can still present one.
  ['merge.we-generated.recursive', 'binary'],
];

try {
  execFileSync('git', ['rev-parse', '--git-dir'], { stdio: 'ignore' });
} catch {
  // A tarball install, or CI running `pnpm install` outside a checkout. Nothing to configure, and
  // nothing broken by not configuring it.
  process.exit(0);
}

for (const [key, value] of settings) {
  execFileSync('git', ['config', key, value], { stdio: 'ignore' });
}

console.log('✓ registered the we-generated merge driver (see .gitattributes)');
