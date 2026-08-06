/**
 * The account registry's rules, against a real temp filesystem.
 *
 * Two of these encode decisions that differ deliberately from the ADAM launcher's equivalent, and
 * both are the kind that only bite once: a name that escapes its parent directory, and removal
 * erasing data another app owns.
 */
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'fs';
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

  it('falls back when the selected directory has been renamed away', () => {
    const created = registry.create();
    expect(registry.resolveActivePath()).toBe(created.id);

    renameSync(created.id, `${created.id}-old`);

    // Previously the selection was only checked against the *list*, so a path that no longer
    // existed was still handed to the executor, which scaffolded it back — undoing the rename.
    expect(registry.resolveActivePath()).toBe(defaultPath);
  });

  it('a renamed-away container is a complete reset, and renaming back restores it', () => {
    registry.setDisplay(defaultPath, { name: 'Personal', avatar: 'data:image/png;base64,AAAA' });
    const created = registry.create();
    registry.setDisplay(created.id, { name: 'Work' });

    renameSync(defaultPath, `${defaultPath}-old`);

    // The whole world went with it: accounts and the metadata describing them.
    const fresh = createAccountRegistry({ configDir, defaultPath });
    expect(fresh.list()).toHaveLength(0);
    expect(fresh.resolveActivePath()).toBe(defaultPath);

    renameSync(`${defaultPath}-old`, defaultPath);

    // ...and came back whole, names included. Metadata for an absent path is deliberately kept
    // rather than pruned, which is what makes this a backup rather than a one-way delete.
    const restored = createAccountRegistry({ configDir, defaultPath });
    expect(
      restored
        .list()
        .map((a) => a.name)
        .sort(),
    ).toEqual(['Personal', 'Work']);
  });
});

describe('sharing the registry file with the other host', () => {
  it('reads the snake_case selection the tauri host used to write', () => {
    // One file, two hosts. Tauri wrote `selected_path` for a while; read as `selectedPath` only,
    // the selection silently resets to whichever account is first.
    const other = join(defaultPath, 'we-accounts', 'other');
    seedAd4mData(other);
    mkdirSync(join(defaultPath, 'we-accounts'), { recursive: true });
    writeFileSync(
      join(defaultPath, 'we-accounts', 'registry.json'),
      JSON.stringify({ accounts: [{ name: 'Other', path: other }], selected_path: other }),
      'utf8',
    );

    expect(createAccountRegistry({ configDir, defaultPath }).resolveActivePath()).toBe(other);
  });
});

describe('migrating out of the pre-container layout', () => {
  it('moves the directories in and rewrites the registry', () => {
    // Accounts used to live in the app's own config directory, with the registry beside them —
    // so a machine upgrading has real accounts sitting outside the container.
    const legacyAgents = join(configDir, 'agents', 'work');
    seedAd4mData(legacyAgents);
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'we-accounts.json'),
      JSON.stringify({
        accounts: [
          { name: 'Main', path: defaultPath },
          { name: 'Work', path: legacyAgents, avatar: 'data:image/png;base64,AAAA' },
        ],
        selectedPath: legacyAgents,
      }),
      'utf8',
    );

    const migrated = createAccountRegistry({ configDir, defaultPath });

    // The directory moved rather than being registered where it lay: leaving it outside would
    // quietly break the promise that moving the container takes everything.
    const target = join(defaultPath, 'we-accounts', 'work');
    expect(existsSync(target)).toBe(true);
    expect(existsSync(legacyAgents)).toBe(false);

    // Names, pictures and the selection all survive the move.
    const work = migrated.list().find((a) => a.id === target);
    expect(work).toMatchObject({ name: 'Work', avatar: 'data:image/png;base64,AAAA', active: true });
    expect(migrated.resolveActivePath()).toBe(target);
  });

  it('does not run again when the container is wiped for a clean slate', () => {
    // The container going away is the supported way to start fresh. Keying "already migrated" on
    // the new registry existing meant wiping it left the old file to repopulate the next boot with
    // the accounts that had just been deleted.
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'we-accounts.json'),
      JSON.stringify({ accounts: [{ name: 'Ghost', path: defaultPath }], selectedPath: defaultPath }),
      'utf8',
    );
    createAccountRegistry({ configDir, defaultPath });

    rmSync(defaultPath, { recursive: true, force: true });
    mkdirSync(defaultPath, { recursive: true }); /* as `init` scaffolds it on the next boot */

    expect(createAccountRegistry({ configDir, defaultPath }).list()[0].name).toBe('Main');
  });

  it('runs once, and leaves an already-migrated registry alone', () => {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, 'we-accounts.json'),
      JSON.stringify({ accounts: [{ name: 'Stale', path: defaultPath }], selectedPath: defaultPath }),
      'utf8',
    );

    createAccountRegistry({ configDir, defaultPath }).setDisplay(defaultPath, { name: 'Renamed' });
    // The legacy file still exists; a second migration would overwrite the rename with 'Stale'.
    expect(createAccountRegistry({ configDir, defaultPath }).list()[0].name).toBe('Renamed');
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

  it('keeps created accounts inside the container, so one move takes everything', () => {
    expect(registry.create().id.startsWith(join(defaultPath, 'we-accounts'))).toBe(true);
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

  it('erases a nested account and its data — provenance is not the guard', () => {
    seedAd4mData(defaultPath);
    const created = registry.create();
    seedAd4mData(created.id);
    registry.select(defaultPath);

    registry.remove(created.id);

    expect(registry.list().map((a) => a.id)).toEqual([defaultPath]);
    expect(existsSync(created.id)).toBe(false);
  });

  it('refuses the container account while it holds the others', () => {
    seedAd4mData(defaultPath);
    const created = registry.create();
    registry.select(created.id);

    // Its directory *contains* the others, so `rm -rf` on it would take the account being used.
    // The way to clear this one is to move the directory aside — the same gesture that backs
    // everything up, which is why this is refused rather than handled.
    expect(() => registry.remove(defaultPath)).toThrow(/other accounts first/);
    expect(existsSync(defaultPath)).toBe(true);
  });

  it('forgets, but does not delete, an outside path holding no AD4M data', () => {
    // The registry holds arbitrary paths. A mistyped seed dataPath or a corrupted registry must
    // not turn "remove account" into a recursive delete of something unrelated.
    const outside = join(root, 'not-an-account');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'important.txt'), 'keep me', 'utf8');
    mkdirSync(join(defaultPath, 'we-accounts'), { recursive: true });
    writeFileSync(
      join(defaultPath, 'we-accounts', 'registry.json'),
      JSON.stringify({ accounts: [{ name: 'Bad path', path: outside }], selectedPath: defaultPath }),
      'utf8',
    );

    registry.remove(outside);

    expect(registry.list().map((a) => a.id)).toEqual([defaultPath]);
    expect(existsSync(join(outside, 'important.txt'))).toBe(true);
  });

  it('deletes an abandoned account inside the container, which has no markers yet', () => {
    // The shape check is for paths we did not create. Applying it here would skip the delete,
    // leave the directory on disk, and the scan would put the account straight back in the list.
    const created = registry.create();
    registry.select(defaultPath);

    registry.remove(created.id);

    expect(existsSync(created.id)).toBe(false);
    expect(registry.list().map((a) => a.id)).toEqual([defaultPath]);
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
