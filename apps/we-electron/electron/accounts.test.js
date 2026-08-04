/**
 * The account registry's rules, against a real temp filesystem.
 *
 * Two of these encode decisions that differ deliberately from the ADAM launcher's equivalent, and
 * both are the kind that only bite once: a name that escapes its parent directory, and removal
 * erasing data another app owns.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createAccountRegistry, expandHome, slugify, uniqueName } from './accounts.js';

/** Make a directory look like an AD4M data dir, which is what deletion checks for. */
function seedAd4mData(path) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'mainnet_seed.seed'), '{}', 'utf8');
}

let root;
let configDir;
let defaultPath;
let registry;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'we-accounts-'));
  configDir = join(root, 'config');
  defaultPath = join(root, '.ad4m');
  mkdirSync(defaultPath, { recursive: true });
  registry = createAccountRegistry({ configDir, defaultPath });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('seeding', () => {
  it('starts with one account pointing at the seed path', () => {
    const accounts = registry.list();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: defaultPath, name: 'Main', active: true });
  });

  it('re-seeds rather than refusing to start when the registry is corrupt', () => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'we-accounts.json'), 'not json at all', 'utf8');

    // Losing the list is recoverable; an app that will not open is not.
    expect(registry.resolveActivePath()).toBe(defaultPath);
  });

  it('falls back when the selection points at an account no longer listed', () => {
    const created = registry.create();
    registry.remove(defaultPath); /* not selected, so allowed */
    expect(registry.resolveActivePath()).toBe(created.id);
  });
});

describe('creating', () => {
  it('creates the directory but no identity, under a provisional name, and makes it active', () => {
    const account = registry.create();

    // No name is asked for here: the setup screen collects it after the restart, so first run and
    // adding an account reach the same page.
    expect(account.name).toBe('New account');
    expect(existsSync(account.id)).toBe(true);
    expect(registry.resolveActivePath()).toBe(account.id);
  });

  it('keeps created accounts inside the managed root', () => {
    const managed = join(configDir, 'agents');
    expect(registry.create().id.startsWith(managed)).toBe(true);
  });

  it('distinguishes repeated creations, in both name and directory', () => {
    const a = registry.create();
    const b = registry.create();
    expect(a.id).not.toBe(b.id);
    // A user who abandons setup twice must be able to tell the two apart in the switcher.
    expect(b.name).toBe('New account 2');
    expect(registry.list()).toHaveLength(3);
  });
});

describe('setDisplay — mirroring the profile onto the account', () => {
  it('commits the name the setup screen collected', () => {
    const created = registry.create();
    registry.setDisplay(created.id, { name: '  Work  ' });

    expect(registry.list().find((a) => a.id === created.id).name).toBe('Work');
    // The directory keeps its original slug — only the label changes.
    expect(created.id).toContain('new-account');
  });

  it('names the seeded account too, which is what first run does', () => {
    registry.setDisplay(defaultPath, { name: 'Personal' });
    expect(registry.list()[0].name).toBe('Personal');
  });

  it('caches a picture the locked sign-in screen can show', () => {
    registry.setDisplay(defaultPath, { avatar: 'data:image/png;base64,AAAA' });
    expect(registry.list()[0].avatar).toBe('data:image/png;base64,AAAA');
  });

  it('updates one field without clearing the other', () => {
    registry.setDisplay(defaultPath, { name: 'Personal', avatar: 'data:image/png;base64,AAAA' });
    registry.setDisplay(defaultPath, { name: 'Work' });

    const account = registry.list()[0];
    expect(account.name).toBe('Work');
    expect(account.avatar).toBe('data:image/png;base64,AAAA');
  });

  it('refuses an oversized picture rather than bloating the registry', () => {
    const huge = `data:image/png;base64,${'A'.repeat(300_000)}`;
    registry.setDisplay(defaultPath, { name: 'Kept', avatar: huge });

    const account = registry.list()[0];
    // The name still lands; only the image is dropped, and the badge falls back to initials.
    expect(account.name).toBe('Kept');
    expect(account.avatar).toBeUndefined();
  });

  it('refuses a blank name or an unknown account', () => {
    expect(() => registry.setDisplay(defaultPath, { name: '   ' })).toThrow(/name is required/);
    expect(() => registry.setDisplay('/nowhere', { name: 'X' })).toThrow(/No such account/);
  });
});

describe('selecting', () => {
  it('changes which account resolves as active', () => {
    const created = registry.create();
    registry.select(defaultPath);
    expect(registry.resolveActivePath()).toBe(defaultPath);

    registry.select(created.id);
    expect(registry.resolveActivePath()).toBe(created.id);
  });

  it('refuses an unknown account', () => {
    expect(() => registry.select('/nowhere')).toThrow(/No such account/);
  });
});

describe('removing', () => {
  it('refuses the account currently signed in to', () => {
    expect(() => registry.remove(defaultPath)).toThrow(/signed in to/);
  });

  it('erases the data of an account it created', () => {
    const created = registry.create();
    seedAd4mData(created.id);
    registry.select(defaultPath);

    registry.remove(created.id);

    expect(registry.list().map((a) => a.id)).toEqual([defaultPath]);
    expect(existsSync(created.id)).toBe(false);
  });

  it('erases an account another app created too — provenance is not the guard', () => {
    // `~/.ad4m` is not "Flux's account", it is the user's account that Flux also uses, and WE is
    // as much an AD4M client as the launcher is.
    seedAd4mData(defaultPath);
    const created = registry.create();
    expect(registry.resolveActivePath()).toBe(created.id);

    registry.remove(defaultPath);

    expect(registry.list().map((a) => a.id)).toEqual([created.id]);
    expect(existsSync(defaultPath)).toBe(false);
  });

  it('forgets, but does not delete, a path holding no AD4M data', () => {
    // The registry holds arbitrary paths. A mistyped seed dataPath or a corrupted registry must
    // not turn "remove account" into a recursive delete of something unrelated. defaultPath has
    // no AD4M markers here — it stands in for whatever a bad path might point at.
    writeFileSync(join(defaultPath, 'important.txt'), 'keep me', 'utf8');

    const created = registry.create();
    registry.select(created.id);

    registry.remove(defaultPath);

    // Dropped from the list...
    expect(registry.list().map((a) => a.id)).toEqual([created.id]);
    // ...but nothing on disk was touched.
    expect(existsSync(join(defaultPath, 'important.txt'))).toBe(true);
  });

  it('reports which account holds the launcher registry, so removal can warn about it', () => {
    writeFileSync(join(defaultPath, 'launcher-state.json'), '{}', 'utf8');
    const created = registry.create();

    const accounts = registry.list();
    expect(accounts.find((a) => a.id === defaultPath).sharedWithLauncher).toBe(true);
    expect(accounts.find((a) => a.id === created.id).sharedWithLauncher).toBe(false);
  });
});

describe('pruneAbandoned', () => {
  it('removes an account whose setup was never finished', () => {
    const created = registry.create();
    seedAd4mData(created.id);
    registry.select(defaultPath);

    registry.pruneAbandoned();

    expect(registry.list().map((a) => a.id)).toEqual([defaultPath]);
    expect(existsSync(created.id)).toBe(false);
  });

  it('keeps one whose setup completed — a name means the agent exists', () => {
    const created = registry.create();
    registry.setDisplay(created.id, { name: 'Work' });
    registry.select(defaultPath);

    registry.pruneAbandoned();

    expect(registry.list().map((a) => a.name)).toContain('Work');
  });

  it('never removes the account being signed in to, even mid-setup', () => {
    // Created and selected but not yet named: this is exactly the state of a first boot into a
    // new account, and pruning it would delete the account the user is setting up.
    const created = registry.create();

    registry.pruneAbandoned();

    expect(registry.list().map((a) => a.id)).toContain(created.id);
    expect(registry.resolveActivePath()).toBe(created.id);
  });

  it('leaves adopted accounts alone — they were never provisional', () => {
    const created = registry.create();
    registry.setDisplay(created.id, { name: 'Work' });

    registry.pruneAbandoned();

    expect(registry.list().map((a) => a.id)).toContain(defaultPath);
    expect(existsSync(defaultPath)).toBe(true);
  });
});

describe('slugify', () => {
  it('makes a safe directory name', () => {
    expect(slugify('Test Net')).toBe('test-net');
    expect(slugify('!!!')).toBe('account');
    expect(slugify('../../etc')).toBe('etc');
  });

  it('disambiguates against names already taken', () => {
    expect(slugify('Test', ['test'])).toBe('test-2');
    expect(slugify('Test', ['test', 'test-2'])).toBe('test-3');
  });
});

describe('uniqueName', () => {
  it('numbers repeats so abandoned setups stay tellable apart', () => {
    expect(uniqueName('New account', [])).toBe('New account');
    expect(uniqueName('New account', ['New account'])).toBe('New account 2');
    expect(uniqueName('New account', ['New account', 'New account 2'])).toBe('New account 3');
  });
});

describe('expandHome', () => {
  it('expands only a leading tilde', () => {
    const home = process.env.HOME;
    expect(expandHome('~/.ad4m')).toBe(join(home, '.ad4m'));
    expect(expandHome('/tmp/a')).toBe('/tmp/a');
    expect(expandHome('a~b')).toBe('a~b');
  });
});
