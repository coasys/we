/**
 * The account registry: which agent directories exist, and which one this app runs against.
 *
 * An "account" is a data directory. The identity inside it is created on first boot into it, by
 * the setup screen — registering an account deliberately does not create one, because that needs a
 * password the user has not been asked for yet. They are asked once, after the restart, on the
 * same page whether this is a genuine first run or an account being added.
 *
 * ## One container, so a rename is a complete backup
 *
 * Everything lives inside the default data directory: the accounts WE creates at
 * `<data>/we-accounts/<slug>/`, and the registry beside them at `<data>/we-accounts/registry.json`.
 * That directory is `~/.ad4m` unless the seed says otherwise.
 *
 * The point is that `mv ~/.ad4m ~/.ad4m-old` is a complete, reversible reset — every account and
 * all of their metadata leave together, the next boot scaffolds a fresh one, and renaming back
 * restores names, pictures and selection exactly. Accounts scattered across a second location, or
 * a registry in the app's own config directory, both break that: half the state moves and half
 * stays. It also means every host — electron dev, the packaged app, tauri — reads one list, where
 * before each had a private one and none of them agreed.
 *
 * The launcher's `launcher-state.json` sits in the same directory and is criticised below for it.
 * The difference is what the coupling costs: there, deleting one *agent* silently destroys the
 * record of every other, which is loss you did not ask for. Here the container is the unit you
 * move on purpose, and nothing survives it by design.
 *
 * ## The filesystem is the source of truth
 *
 * An account exists because its directory exists — `list()` scans, and the registry only decorates
 * what the scan finds. A registry that decided existence drifted from the disk in both directions:
 * a directory renamed away stayed in the switcher, and `resolveActivePath` would hand it to the
 * executor, which scaffolded it back. Metadata for a path that is currently absent is kept, not
 * pruned: that is exactly what makes renaming back restore an account rather than resurrect a
 * nameless one.
 *
 * ## Deleting checks shape, not provenance
 *
 * Any AD4M account can be deleted, whichever app created it — `~/.ad4m` is not "Flux's account",
 * it is the user's account that Flux also uses, and WE is as much an AD4M client as the launcher.
 *
 * What is checked instead is that the directory actually *is* an AD4M data directory. The registry
 * holds arbitrary paths; a mistyped seed `dataPath` or a corrupted registry would otherwise turn
 * "remove account" into `rm -rf` on whatever that string happens to say. The markers are the ones
 * `init` writes, the same ones the executor's own startup keys on.
 *
 * The container account is refused outright while it holds nested ones, because deleting it means
 * `rm -rf` on the directory they live inside — including, potentially, the account being used.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { basename, join } from 'path';

/** Holds both the accounts WE creates and the registry, inside the default data directory. */
const CONTAINER_DIR = 'we-accounts';
const REGISTRY_FILE = 'registry.json';

/** Ceiling on a cached profile picture, in data-URI characters. ~192 KB, far above an 80px PNG. */
const MAX_AVATAR_CHARS = 200_000;

/** Expands a leading `~`. Only leading — `~` elsewhere in a path is a literal character. */
export function expandHome(p) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return join(homedir(), p.slice(2));
  return p;
}

/**
 * A directory name derived from what the user typed, made safe and unique.
 *
 * Unlike the launcher, which maps a name straight to `~/.<name.toLowerCase()>` with no collision
 * check — so two accounts can silently share one directory, and a name with a slash escapes the
 * home directory entirely.
 */
export function slugify(name, taken = []) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'account';

  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/** `base`, or `base 2`, `base 3`… — so two abandoned setups are still tellable apart in the list. */
export function uniqueName(base, taken = []) {
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/**
 * Whether a path holds an AD4M agent, by the markers `init` writes.
 *
 * The guard on deletion: a registry entry is a path, and a path is not proof that anything of
 * AD4M's is there.
 */
export function looksLikeAd4mData(path) {
  return existsSync(join(path, 'mainnet_seed.seed')) || existsSync(join(path, 'ad4m'));
}

/**
 * Whether the ADAM launcher keeps its own registry inside this account.
 *
 * The launcher stores `launcher-state.json` — its list of every agent it knows about — inside
 * `~/.ad4m`, which is also one of its agents. So deleting that directory erases the launcher's
 * record of all its *other* agents too. That is the launcher's design, not something WE can fix
 * from here, but it is a consequence nobody would predict, so removal names it.
 */
export function holdsLauncherState(path) {
  return existsSync(join(path, 'launcher-state.json'));
}

export function createAccountRegistry({ configDir, defaultPath, defaultName = 'Main' }) {
  /** Accounts WE creates, and the registry, both inside the container. */
  const managedRoot = join(defaultPath, CONTAINER_DIR);
  const registryPath = join(managedRoot, REGISTRY_FILE);
  /** Where accounts used to live, before they moved into the container. Migrated on first read. */
  const legacyRoot = join(configDir, 'agents');
  const legacyRegistry = join(configDir, 'we-accounts.json');

  function read() {
    try {
      const parsed = JSON.parse(readFileSync(registryPath, 'utf8'));
      if (Array.isArray(parsed.accounts)) return parsed;
    } catch {
      // Missing or corrupt — fall through to an empty registry rather than refusing to start.
      // Losing metadata costs names and pictures; the accounts themselves are directories and the
      // scan still finds them. Refusing to open the app would be the worse failure.
    }
    return { accounts: [], selectedPath: null };
  }

  function write(state) {
    mkdirSync(managedRoot, { recursive: true });
    writeFileSync(registryPath, JSON.stringify(state, null, 2), 'utf8');
  }

  /**
   * Every account directory that exists right now.
   *
   * The container's own children, plus the container itself (the default account, which has to
   * live at the data path the launcher and Flux expect rather than one level down), plus any
   * registry path pointing outside — an account adopted from elsewhere. Filtered by existence,
   * which is the whole mechanism: a directory renamed away simply stops being listed.
   */
  function scan(state) {
    const paths = [];
    if (existsSync(defaultPath)) paths.push(defaultPath);

    try {
      for (const entry of readdirSync(managedRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) paths.push(join(managedRoot, entry.name));
      }
    } catch {
      // No container yet — nothing has been created beyond the default account.
    }

    for (const account of state.accounts) {
      if (!paths.includes(account.path) && existsSync(account.path)) paths.push(account.path);
    }
    return paths;
  }

  /**
   * Move accounts out of the pre-container layout, once.
   *
   * Their directories move rather than being re-registered in place: the point of the container is
   * that one `mv` takes everything, which a path left behind in the app's config directory would
   * quietly break. Registry paths are rewritten to match.
   */
  function migrateLegacyLayout() {
    if (existsSync(registryPath) || !existsSync(legacyRegistry)) return;

    let legacy;
    try {
      legacy = JSON.parse(readFileSync(legacyRegistry, 'utf8'));
    } catch {
      return;
    }
    if (!Array.isArray(legacy.accounts)) return;

    mkdirSync(managedRoot, { recursive: true });
    const moved = new Map();
    for (const account of legacy.accounts) {
      if (!account.path?.startsWith(legacyRoot + '/')) continue;
      const target = join(managedRoot, account.path.slice(legacyRoot.length + 1));
      if (!existsSync(account.path) || existsSync(target)) continue;
      try {
        renameSync(account.path, target);
        moved.set(account.path, target);
      } catch (e) {
        // Across filesystems rename fails; leave it registered where it is rather than copying
        // gigabytes of Holochain state. The scan still finds it via its registry path.
        console.warn('[accounts] Could not move an account into the container:', e.message);
      }
    }

    const rewrite = (p) => moved.get(p) ?? p;
    write({
      accounts: legacy.accounts.map((a) => ({ ...a, path: rewrite(a.path) })),
      selectedPath: legacy.selectedPath ? rewrite(legacy.selectedPath) : null,
    });
    console.log(`[accounts] Migrated ${legacy.accounts.length} account(s) into ${managedRoot}`);
  }

  /** The accounts stored inside the container, which the default account's directory holds. */
  function nestedAccounts() {
    try {
      return readdirSync(managedRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => join(managedRoot, e.name));
    } catch {
      return [];
    }
  }

  migrateLegacyLayout();

  return {
    /**
     * Drop accounts whose setup was never finished.
     *
     * Only ones this app created and never saw completed, and never the selected one — that is
     * either mid-setup right now or the account about to be signed in to. Called once at startup,
     * so an abandoned account survives exactly as long as the session that abandoned it.
     */
    pruneAbandoned() {
      const state = read();
      const activePath = this.resolveActivePath();
      const abandoned = state.accounts.filter((a) => a.provisional && a.path !== activePath);
      if (!abandoned.length) return;

      write({ ...state, accounts: state.accounts.filter((a) => !abandoned.includes(a)) });

      for (const account of abandoned) {
        // Same shape check as remove(): a registry entry is a path, not proof of what is there.
        if (!account.path.startsWith(managedRoot + '/') || !existsSync(account.path)) continue;
        try {
          rmSync(account.path, { recursive: true, force: true });
        } catch (e) {
          console.warn('[accounts] Could not delete an abandoned account:', e.message);
        }
      }
      console.log(`[accounts] Removed ${abandoned.length} account(s) whose setup was never finished`);
    },

    /**
     * The data path this launch should use. Also self-heals: a registry whose selection points at
     * an account that is no longer listed falls back to the first one rather than starting the
     * executor against a directory nothing knows about.
     */
    resolveActivePath() {
      const state = read();
      const present = scan(state);
      if (state.selectedPath && present.includes(state.selectedPath)) return state.selectedPath;

      // The selection is gone — renamed away, or deleted from under us. Fall back to any account
      // that is really there, and to the seed default when none is, which the caller then
      // scaffolds into a fresh first run. Selecting a path that does not exist is what previously
      // made `init` recreate a directory the user had deliberately moved aside.
      const fallback = present[0] ?? defaultPath;
      // Only persisted when it names an account that is really there. Writing the registry creates
      // the container directory, so recording a fallback to a `defaultPath` that does not exist
      // would recreate the very directory the user had just moved aside — and merely *listing*
      // accounts would undo their reset. Returning it unwritten is enough: the caller scaffolds it
      // deliberately, and the selection is recorded the next time one is actually made.
      if (present.includes(fallback) && state.selectedPath !== fallback) {
        write({ ...state, selectedPath: fallback });
      }
      return fallback;
    },

    list() {
      const state = read();
      const activePath = this.resolveActivePath();
      const byPath = new Map(state.accounts.map((a) => [a.path, a]));

      return scan(state).map((path) => {
        // No entry means a directory nobody has named yet — the default account on a first run,
        // or one restored by renaming a backup back into place before its metadata caught up.
        const meta = byPath.get(path) ?? {};
        return {
          id: path,
          name: meta.name ?? (path === defaultPath ? defaultName : basename(path)),
          ...(meta.avatar ? { avatar: meta.avatar } : {}),
          active: path === activePath,
          sharedWithLauncher: holdsLauncherState(path),
        };
      });
    },

    /**
     * Register a new account under a provisional name and select it.
     *
     * The real name is collected by the setup screen after the restart, so that first run and
     * adding an account reach the same page. Until then the account still needs *a* name — it is
     * listed in the switcher, and a user who abandons setup must be able to tell it apart.
     */
    create() {
      const state = read();
      const name = uniqueName(
        'New account',
        state.accounts.map((a) => a.name),
      );

      // Slugs are taken from what is on disk, not from the registry: a directory left behind by an
      // account whose metadata is gone would otherwise be silently adopted by the next create.
      let takenSlugs = [];
      try {
        takenSlugs = readdirSync(managedRoot, { withFileTypes: true })
          .filter((e) => e.isDirectory())
          .map((e) => e.name);
      } catch {
        // No container yet — nothing is taken.
      }
      const path = join(managedRoot, slugify(name, takenSlugs));

      if (existsSync(path)) throw new Error('That account already exists');

      mkdirSync(path, { recursive: true });
      // Provisional until setup finishes. An account whose setup is abandoned — switched away
      // from, or the app closed at the password screen — has a directory and a placeholder name
      // and no identity in it, and would otherwise sit in the switcher forever looking real.
      write({ accounts: [...state.accounts, { name, path, provisional: true }], selectedPath: path });
      return { id: path, name, active: true };
    },

    /**
     * Mirror the profile's name and picture onto the account, so a locked sign-in screen has
     * something to show. Both fields optional — an edit to one must not clear the other.
     *
     * The directory keeps its original slug whatever the name becomes: renaming a data directory
     * to match a label buys nothing and risks everything inside it.
     */
    setDisplay(id, { name, avatar } = {}) {
      const state = read();
      if (!scan(state).includes(id)) throw new Error('No such account');
      // The scan can surface an account the registry has no entry for — the default one on a first
      // run, most often. Naming it is what creates the entry.
      if (!state.accounts.some((a) => a.path === id)) state.accounts = [...state.accounts, { path: id, name: '' }];

      const trimmed = typeof name === 'string' ? name.trim() : undefined;
      if (name !== undefined && !trimmed) throw new Error('An account name is required');

      // Guard the registry against an oversized image. compressImageToFileData already caps the
      // longest edge at 80px, so this should never fire — but a JSON file the app cannot start
      // without is the wrong place to find out that an assumption changed upstream.
      const withinCap = typeof avatar === 'string' && avatar.length <= MAX_AVATAR_CHARS;
      if (avatar !== undefined && !withinCap) {
        console.warn('[accounts] Profile picture too large to cache; falling back to initials');
      }

      write({
        ...state,
        accounts: state.accounts.map((a) => {
          if (a.path !== id) return a;
          const next = { ...a, ...(trimmed ? { name: trimmed } : {}), ...(withinCap ? { avatar } : {}) };
          // A name arriving is setup completing: it is written once the agent exists, so the
          // account stops being provisional and survives the next prune.
          if (trimmed) delete next.provisional;
          return next;
        }),
      });
    },

    select(id) {
      const state = read();
      if (!scan(state).includes(id)) throw new Error('No such account');
      write({ ...state, selectedPath: id });
    },

    remove(id) {
      const state = read();
      if (this.resolveActivePath() === id) throw new Error('Cannot remove the account you are signed in to');
      if (!scan(state).includes(id)) throw new Error('No such account');

      // The default account's directory *contains* every other account, so deleting it would take
      // them all — including, if one of them is selected, the account being used. Refused rather
      // than handled: the way to clear this account is to move the directory aside, which is the
      // same gesture that backs everything up.
      if (id === defaultPath && nestedAccounts().length) {
        throw new Error('Remove the other accounts first — they are stored inside this one');
      }

      write({ ...state, accounts: state.accounts.filter((a) => a.path !== id) });

      // Erase the data — for any account, whoever created it — but for paths *outside* the
      // container only once the directory has been confirmed to hold an agent. See the file
      // header: a registry entry is a path, and a path is not proof of what is there.
      //
      // Inside the container the check would do harm rather than good. We created those
      // directories, so provenance is not in question, and an account abandoned before setup has
      // no AD4M markers yet — skipping the delete would leave the directory on disk, where the
      // scan finds it again and puts it straight back in the list. The user would click remove
      // and watch nothing happen.
      const isOurs = id.startsWith(managedRoot + '/');
      if (!isOurs && !looksLikeAd4mData(id)) {
        console.warn('[accounts] Account forgotten; its path holds no AD4M data, so nothing deleted:', id);
        return;
      }
      try {
        rmSync(id, { recursive: true, force: true });
      } catch (e) {
        console.warn('[accounts] Account forgotten but its data could not be deleted:', e.message);
      }
    },
  };
}
