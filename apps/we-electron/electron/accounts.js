/**
 * The account registry: which agent directories exist, and which one this app runs against.
 *
 * An "account" is a data directory. The identity inside it is created on first boot into it, by
 * the setup screen — registering an account deliberately does not create one, because that needs a
 * password the user has not been asked for yet. They are asked once, after the restart, on the
 * same page whether this is a genuine first run or an account being added.
 *
 * ## Where the registry lives, and why not where the launcher puts it
 *
 * The ADAM launcher keeps its equivalent at `~/.ad4m/launcher-state.json` — inside the default
 * agent's own data directory. That means clearing that agent destroys the list of every *other*
 * agent along with it. This one lives in the app's config directory, which no agent owns.
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
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const REGISTRY_FILE = 'we-accounts.json';

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
  const registryPath = join(configDir, REGISTRY_FILE);
  /** Where accounts WE create are put. Not a deletion guard — see the file header. */
  const managedRoot = join(configDir, 'agents');

  function read() {
    try {
      const parsed = JSON.parse(readFileSync(registryPath, 'utf8'));
      if (Array.isArray(parsed.accounts) && parsed.accounts.length) return parsed;
    } catch {
      // Missing or corrupt — fall through and re-seed rather than refusing to start. Losing the
      // list of accounts is recoverable (the directories are still there to re-add); refusing to
      // open the app is not.
    }
    return { accounts: [{ name: defaultName, path: defaultPath }], selectedPath: defaultPath };
  }

  function write(state) {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(registryPath, JSON.stringify(state, null, 2), 'utf8');
  }

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
        if (!account.path.startsWith(managedRoot) || !existsSync(account.path)) continue;
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
      const selected = state.accounts.find((a) => a.path === state.selectedPath);
      if (selected) return selected.path;

      const fallback = state.accounts[0];
      write({ ...state, selectedPath: fallback.path });
      return fallback.path;
    },

    list() {
      const state = read();
      const activePath = this.resolveActivePath();
      return state.accounts.map((a) => ({
        id: a.path,
        name: a.name,
        ...(a.avatar ? { avatar: a.avatar } : {}),
        active: a.path === activePath,
        sharedWithLauncher: holdsLauncherState(a.path),
      }));
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

      const takenSlugs = state.accounts
        .filter((a) => a.path.startsWith(managedRoot))
        .map((a) => a.path.slice(managedRoot.length + 1));
      const path = join(managedRoot, slugify(name, takenSlugs));

      if (state.accounts.some((a) => a.path === path)) throw new Error('That account already exists');

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
      if (!state.accounts.some((a) => a.path === id)) throw new Error('No such account');

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
      if (!state.accounts.some((a) => a.path === id)) throw new Error('No such account');
      write({ ...state, selectedPath: id });
    },

    remove(id) {
      const state = read();
      if (state.selectedPath === id) throw new Error('Cannot remove the account you are signed in to');
      if (!state.accounts.some((a) => a.path === id)) throw new Error('No such account');

      write({ ...state, accounts: state.accounts.filter((a) => a.path !== id) });

      // Erase the data — for any account, whoever created it — but only once the directory has
      // been confirmed to hold an agent. See the file header.
      if (!looksLikeAd4mData(id)) {
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
