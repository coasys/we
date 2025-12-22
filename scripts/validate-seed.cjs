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
  }

  if (!seed.apps || !Array.isArray(seed.apps)) {
    error('Missing or invalid field: apps (must be array)');
  } else if (seed.apps.length === 0) {
    error('No apps defined in seed file');
  } else {
    success(`Found ${seed.apps.length} app(s)`);
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
      const distPath = path.isAbsolute(app.paths.dist)
        ? app.paths.dist
        : path.resolve(WORKSPACE_ROOT, app.paths.dist);
      
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
