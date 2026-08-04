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

describe('renaming', () => {
  it('commits the name the setup screen collected', () => {
    const created = registry.create();
    registry.rename(created.id, '  Work  ');

    const renamed = registry.list().find((a) => a.id === created.id);
    expect(renamed.name).toBe('Work');
    // The directory keeps its original slug — only the label changes.
    expect(created.id).toContain('new-account');
  });

  it('renames the seeded account too, which is what first run does', () => {
    registry.rename(defaultPath, 'Personal');
    expect(registry.list()[0].name).toBe('Personal');
  });

  it('refuses a blank name or an unknown account', () => {
    expect(() => registry.rename(defaultPath, '   ')).toThrow(/name is required/);
    expect(() => registry.rename('/nowhere', 'X')).toThrow(/No such account/);
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
    registry.select(defaultPath);

    registry.remove(created.id);

    expect(registry.list().map((a) => a.id)).toEqual([defaultPath]);
    expect(existsSync(created.id)).toBe(false);
  });

  it('forgets an adopted account without deleting its data', () => {
    // `~/.ad4m` is shared with the ADAM launcher and Flux. Removing it from WE's list must not
    // destroy their agent — "remove account" is not a licence to delete another app's data.
    const created = registry.create();
    expect(registry.resolveActivePath()).toBe(created.id);

    registry.remove(defaultPath);

    expect(registry.list().map((a) => a.id)).toEqual([created.id]);
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
