#!/usr/bin/env node

/**
 * WE Seed File Validator
 *
 * Validates the we-seed.json configuration file for correctness.
 * Checks JSON syntax, required fields, and path existence.
 *
 * Usage: pnpm validate
 */

const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const SEED_FILE = path.join(WORKSPACE_ROOT, 'we-seed.json');

let errors = [];
let warnings = [];

function error(message) {
  errors.push(message);
  console.error(`❌ ${message}`);
}

function warn(message) {
  warnings.push(message);
  console.warn(`⚠️  ${message}`);
}

function info(message) {
  console.log(`ℹ️  ${message}`);
}

function success(message) {
  console.log(`✅ ${message}`);
}

function main() {
  console.log('🔍 Validating we-seed.json...\n');

  // Check file exists
  if (!fs.existsSync(SEED_FILE)) {
    error(`Seed file not found: ${SEED_FILE}`);
    process.exit(1);
  }

  // Parse JSON
  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    success('Valid JSON syntax');
  } catch (err) {
    error(`Invalid JSON: ${err.message}`);
    process.exit(1);
  }

  // Validate structure
  console.log('\n📋 Checking required fields...');

  if (!seed.project) {
    error('Missing required field: project');
  } else {
    success('project defined');
  }

  if (!seed.ad4m) {
    error('Missing required field: ad4m');
  } else {
    if (!seed.ad4m.executorPath) {
      error('Missing required field: ad4m.executorPath');
    } else {
      success('ad4m.executorPath defined');
    }

    if (!seed.ad4m.repoPath) {
      warn('Missing ad4m.repoPath - Tauri Cargo.toml generation will fail');
    } else {
      success('ad4m.repoPath defined');
    }

    // Always report the effective path. Pointing it away from the default is a data migration,
    // not a preference — an existing agent does not follow, and a desktop build would come up
    // empty with no error. Cheaper to notice here than after losing a day's spaces.
    const dataPath = seed.ad4m.dataPath || '~/.ad4m';
    if (!seed.ad4m.dataPath) {
      success('ad4m.dataPath not set - defaulting to ~/.ad4m (shared with the ADAM launcher)');
    } else if (dataPath === '~/.ad4m') {
      success('ad4m.dataPath is ~/.ad4m (shared with the ADAM launcher)');
    } else {
      warn(
        `ad4m.dataPath is ${dataPath}, not the default ~/.ad4m — desktop builds will use a ` +
          `separate agent store. An agent already in ~/.ad4m will NOT be visible there.`,
      );
    }

    // The URL is baked into every space published through it, so a typo is permanent for that
    // space: its members would sync against nothing.
    if (seed.ad4m.linkServerUrl) {
      if (!/^https?:\/\/[^\s/]+/.test(seed.ad4m.linkServerUrl)) {
        error(`ad4m.linkServerUrl must be an http(s) URL, got: ${seed.ad4m.linkServerUrl}`);
      } else {
        success(`ad4m.linkServerUrl is ${seed.ad4m.linkServerUrl} (server link language offered for shared spaces)`);
      }
    }
  }

  if (!seed.apps || !Array.isArray(seed.apps)) {
    error('Missing or invalid field: apps (must be array)');
  } else if (seed.apps.length === 0) {
    info('No apps defined - native WE app mode (template switching enabled)');
    success('Apps array is valid (empty for native mode)');
  } else {
    success(`Found ${seed.apps.length} app(s)`);
  }

  // Validate modules — the list `generate-modules` bundles from.
  console.log('\n🧩 Validating modules...');
  if (seed.modules === undefined) {
    info('No modules declared - the build ships none');
  } else if (!Array.isArray(seed.modules)) {
    error('Invalid field: modules (must be an array of ids or { id, package?, enabled? } entries)');
  } else {
    const moduleIds = new Set();
    seed.modules.forEach((entry, index) => {
      const module = typeof entry === 'string' ? { id: entry } : entry;
      if (!module || typeof module.id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(module.id)) {
        error(
          `  Module ${index + 1}: needs an id of lower-case letters, digits and dashes (got ${JSON.stringify(entry)})`,
        );
        return;
      }
      if (moduleIds.has(module.id)) error(`  Module ${index + 1}: Duplicate module id '${module.id}'`);
      moduleIds.add(module.id);
      if (module.package !== undefined && typeof module.package !== 'string') {
        error(`  Module '${module.id}': package must be a string`);
      }
      if (module.enabled !== undefined && typeof module.enabled !== 'boolean') {
        error(`  Module '${module.id}': enabled must be a boolean`);
      }
      const pkg = module.package || `@we/module-${module.id}`;
      const installed = fs.existsSync(path.join(__dirname, '..', 'packages', 'app-shell', 'node_modules', pkg));
      if (!installed) {
        warn(
          `  Module '${module.id}': package ${pkg} is not installed for @we/app-shell — the build will fail until it is`,
        );
      }
    });
    if (seed.modules.length) success(`Found ${seed.modules.length} module(s): ${[...moduleIds].join(', ')}`);
  }

  // Validate elements — custom elements from libraries the build defines and templates may name.
  if (seed.elements !== undefined) {
    console.log('\n🧱 Validating elements...');
    if (!Array.isArray(seed.elements)) {
      error('Invalid field: elements (must be an array of { package, define?, tags?, manifest? } entries)');
    } else {
      const tags = new Set();
      seed.elements.forEach((entry, index) => {
        if (!entry || typeof entry.package !== 'string' || !entry.package) {
          error(`  Elements ${index + 1}: needs a package`);
          return;
        }
        for (const key of ['define', 'tags']) {
          if (
            entry[key] !== undefined &&
            !(Array.isArray(entry[key]) && entry[key].every((v) => typeof v === 'string'))
          ) {
            error(`  Elements '${entry.package}': ${key} must be a list of strings`);
          }
        }
        for (const tag of entry.tags ?? []) {
          if (!/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(tag))
            error(`  Elements '${entry.package}': "${tag}" is not a custom-element name`);
          else if (tag.startsWith('we-')) error(`  Elements '${entry.package}': "${tag}" is in WE's own namespace`);
          else if (tags.has(tag)) error(`  Elements '${entry.package}': "${tag}" is named twice`);
          tags.add(tag);
        }
        const installed = fs.existsSync(
          path.join(__dirname, '..', 'packages', 'app-shell', 'node_modules', entry.package),
        );
        if (!installed) {
          warn(`  Elements '${entry.package}': not installed for @we/app-shell — the build will fail until it is`);
        }
      });
      if (seed.elements.length) success(`Found ${seed.elements.length} element package(s)`);
    }
  }

  // Validate each app
  console.log('\n📦 Validating apps...');

  const appIds = new Set();
  const appPorts = new Set();

  seed.apps.forEach((app, index) => {
    console.log(`\n  App ${index + 1}: ${app.name || '<unnamed>'}`);

    if (!app.id) {
      error(`  App ${index + 1}: Missing required field 'id'`);
    } else {
      if (appIds.has(app.id)) {
        error(`  App ${index + 1}: Duplicate app id '${app.id}'`);
      }
      appIds.add(app.id);
      info(`  ID: ${app.id}`);
    }

    if (!app.name) {
      warn(`  App ${index + 1}: Missing 'name' field`);
    }

    if (!app.paths) {
      error(`  App ${index + 1}: Missing required field 'paths'`);
    } else {
      if (!app.paths.dist) {
        error(`  App ${index + 1}: Missing required field 'paths.dist'`);
      } else {
        info(`  Dist path: ${app.paths.dist}`);
      }

      if (app.paths.devServer && app.paths.devServer.port) {
        if (appPorts.has(app.paths.devServer.port)) {
          error(`  App ${index + 1}: Duplicate dev server port ${app.paths.devServer.port}`);
        }
        appPorts.add(app.paths.devServer.port);
      }
    }
  });

  // Check paths exist
  console.log('\n📁 Checking paths...');

  if (seed.ad4m && seed.ad4m.executorPath) {
    const executorPath = path.isAbsolute(seed.ad4m.executorPath)
      ? seed.ad4m.executorPath
      : path.resolve(WORKSPACE_ROOT, seed.ad4m.executorPath);

    if (fs.existsSync(executorPath)) {
      success(`AD4M executor found at ${seed.ad4m.executorPath}`);
    } else {
      warn(`AD4M executor not found at ${seed.ad4m.executorPath}`);
      info('  Run: cd ../ad4m && cargo build --release');
    }
  }

  if (seed.ad4m && seed.ad4m.repoPath) {
    const repoPath = path.isAbsolute(seed.ad4m.repoPath)
      ? seed.ad4m.repoPath
      : path.resolve(WORKSPACE_ROOT, seed.ad4m.repoPath);

    if (fs.existsSync(repoPath)) {
      success(`AD4M repo found at ${seed.ad4m.repoPath}`);
    } else {
      error(`AD4M repo not found at ${seed.ad4m.repoPath}`);
    }
  }

  seed.apps.forEach((app) => {
    if (app.paths && app.paths.dist) {
      const distPath = path.isAbsolute(app.paths.dist) ? app.paths.dist : path.resolve(WORKSPACE_ROOT, app.paths.dist);

      if (fs.existsSync(distPath)) {
        success(`${app.name} dist found at ${app.paths.dist}`);
      } else {
        warn(`${app.name} dist not found at ${app.paths.dist}`);
        if (app.commands && app.commands.build) {
          info(`  Build with: cd ${app.paths.projectRoot} && ${app.commands.build}`);
        }
      }
    }
  });

  validateSpaceStarter(seed);

  /*
    Content sources: the same check the build makes, so a bad entry fails here first.

    Imported by path rather than as a dependency of the root. A workspace dependency on the root
    project moves the root's `prepare` — which builds `@we/cli` — after that package in pnpm's
    install order, and every package linked before it is left without a `we-build` binary, so a
    fresh install (CI's) cannot build anything.
  */
  return import(require('url').pathToFileURL(path.join(WORKSPACE_ROOT, 'packages/csp/src/index.js')).href)
    .then(({ seedSources }) => {
      try {
        seedSources(seed);
        if (seed.contentSecurity) success('contentSecurity sources are valid origins');
      } catch (e) {
        error(e.message);
      }
    })
    .then(summarise);
}

/*
  The space starter: what every new space begins with.

  The same checks `starterProblems` makes in the app (packages/app-shell/src/shared/spaceStarter.ts),
  reading the manifest from its source files rather than importing it, so this script keeps running
  under plain node. A starter that would half-apply at a create press fails here instead.
*/
function validateSpaceStarter(seed) {
  const starters = seed.spaceStarters;
  if (!starters) return;
  console.log('\n🌱 Checking the space starters...');
  if (!Array.isArray(starters)) {
    error('spaceStarters: must be a list, the first being what a new space gets');
    return;
  }

  const manifestDir = path.join(WORKSPACE_ROOT, 'packages/entities/src/manifest');
  const entityExists = (name) => fs.existsSync(path.join(manifestDir, `${name}.ts`));
  const spaceSource = fs.readFileSync(path.join(manifestDir, 'Space.ts'), 'utf8');
  const spaceFields = new Set(
    [...spaceSource.matchAll(/^\s{6}(\w+): \{\s*$|^\s{6}(\w+): \{ type:|^\s{6}(\w+): \{ target:/gm)].map(
      (m) => m[1] || m[2] || m[3],
    ),
  );
  const identity = new Set(['uuid', 'url', 'name', 'description', 'discovery', 'avatar', 'coverImage']);
  const templates = new Set(seed.templates || []);
  const modules = new Set((seed.modules || []).map((m) => (typeof m === 'string' ? m : m.id)));
  // A string that is exactly `$<name>` is a reference; see packages/app-shell/src/shared/spaceStarter.ts.
  const refOf = (v) => (typeof v === 'string' ? (/^\$([A-Za-z_][\w-]*)$/.exec(v) || [])[1] || null : null);
  const refsIn = (v) => (Array.isArray(v) ? v : [v]).map(refOf).filter(Boolean);
  const isRefValue = (v) => refOf(v) !== null || (Array.isArray(v) && v.length > 0 && v.every((x) => refOf(x)));
  const placeholdersIn = (v) =>
    typeof v === 'string'
      ? [...v.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1])
      : Array.isArray(v)
        ? v.flatMap(placeholdersIn)
        : v && typeof v === 'object'
          ? Object.values(v).flatMap(placeholdersIn)
          : [];
  const knownPlaceholders = new Set(['space.name', 'space.description']);
  const ids = new Set();

  starters.forEach((starter, n) => {
    const p = `spaceStarters[${n}]`;
    const before = errors.length;
    if (!starter.id) error(`${p}: needs an id`);
    else if (ids.has(starter.id)) error(`${p}.id is used twice: ${starter.id}`);
    ids.add(starter.id);

    for (const key of Object.keys(starter.settings || {})) {
      if (identity.has(key)) error(`${p}.settings.${key} is the space's identity, not a setting`);
      else if (!spaceFields.has(key)) error(`${p}.settings.${key} is not a Space field`);
    }
    const template = (starter.settings || {}).defaultTemplateId;
    if (typeof template === 'string' && !templates.has(template)) {
      error(`${p}.settings.defaultTemplateId names a template the seed does not bundle: ${template}`);
    }
    for (const id of (starter.settings || {}).enabledModules || []) {
      if (!modules.has(id)) error(`${p}.settings.enabledModules names a module the seed does not ship: ${id}`);
    }

    const defined = new Set(['root', 'space']);
    const stateSlugs = new Set(
      (starter.records || []).filter((r) => r.entity === 'TaskState').map((r) => String((r.fields || {}).slug || '')),
    );
    (starter.records || []).forEach((record, index) => {
      const at = `${p}.records[${index}]`;
      // A module's entity lives in its module, not the core manifest — say so rather than refuse it.
      if (!entityExists(record.entity)) warn(`${at}.entity is not a core entity: ${record.entity}`);
      if (record.in !== undefined && record.in !== null) {
        const container = refOf(record.in);
        if (!container || container === 'space' || !defined.has(container)) {
          error(`${at}.in must name $root, an earlier record's $id or null: ${record.in}`);
        }
      }
      for (const [name, value] of Object.entries(record.fields || {})) {
        for (const ref of refsIn(value)) {
          if (!defined.has(ref)) error(`${at}.fields.${name} refers to $${ref}, which no earlier record defines`);
        }
        for (const key of placeholdersIn(value)) {
          if (!knownPlaceholders.has(key)) error(`${at}.fields.${name} has an unknown placeholder: {{${key}}}`);
        }
      }
      const fields = record.fields || {};
      if (
        record.entity === 'CollectionBlock' &&
        fields.kind === 'column' &&
        typeof fields.slug === 'string' &&
        fields.slug
      ) {
        if (!stateSlugs.has(fields.slug))
          error(`${at} is a column for a task state the starter does not define: ${fields.slug}`);
      }
      if (record.$id !== undefined) {
        if (defined.has(record.$id)) error(`${at}.$id is used twice: ${record.$id}`);
        defined.add(record.$id);
      }
    });
    for (const [name, value] of Object.entries(starter.settings || {})) {
      if (!isRefValue(value)) continue;
      for (const ref of refsIn(value)) {
        if (!defined.has(ref)) error(`${p}.settings.${name} refers to $${ref}, which no record defines`);
      }
    }
    for (const [name, ref] of Object.entries(starter.roles || {})) {
      const target = refOf(ref);
      if (!target || target === 'root' || target === 'space' || !defined.has(target))
        error(`${p}.roles.${name} must name a record's $id: ${ref}`);
    }
    if (errors.length === before) success(`space starter "${starter.id}" is valid`);
  });
}

function summarise() {
  // Summary
  console.log('\n' + '='.repeat(50));

  if (errors.length > 0) {
    console.log(`\n❌ Validation failed with ${errors.length} error(s)`);
    if (warnings.length > 0) {
      console.log(`⚠️  ${warnings.length} warning(s)`);
    }
    process.exit(1);
  } else if (warnings.length > 0) {
    console.log(`\n⚠️  Validation passed with ${warnings.length} warning(s)`);
    console.log('You can proceed but some features may not work.');
    process.exit(0);
  } else {
    console.log('\n✅ Validation passed! Seed file is valid.');
    process.exit(0);
  }
}

// Run
main();
