#!/usr/bin/env node

/**
 * WE Workspace Setup Script
 * 
 * This script prepares the entire WE workspace for development or production builds.
 * It validates configuration, checks dependencies, builds packages, and generates
 * platform-specific configurations.
 * 
 * Usage: pnpm setup
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(__dirname, '..');
const SEED_FILE = path.join(WORKSPACE_ROOT, 'we-seed.json');

// ANSI colors for pretty output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function exec(command, options = {}) {
  try {
    return execSync(command, {
      cwd: WORKSPACE_ROOT,
      stdio: 'inherit',
      ...options
    });
  } catch (error) {
    log(`❌ Command failed: ${command}`, 'red');
    throw error;
  }
}

function checkFileExists(filePath, description) {
  if (fs.existsSync(filePath)) {
    log(`✅ ${description}`, 'green');
    return true;
  } else {
    log(`❌ ${description} not found`, 'red');
    log(`   Expected at: ${filePath}`, 'yellow');
    return false;
  }
}

async function main() {
  log('\n🚀 Setting up WE workspace...\n', 'bright');

  // Step 1: Check pnpm installation
  log('📦 Checking pnpm installation...', 'cyan');
  try {
    exec('pnpm --version', { stdio: 'pipe' });
    log('✅ pnpm is installed', 'green');
  } catch {
    log('❌ pnpm is not installed. Please install it: npm install -g pnpm', 'red');
    process.exit(1);
  }

  // Step 2: Install dependencies
  log('\n📦 Installing workspace dependencies...', 'cyan');
  if (!fs.existsSync(path.join(WORKSPACE_ROOT, 'node_modules'))) {
    log('Running pnpm install...', 'blue');
    exec('pnpm install');
  } else {
    log('✅ Dependencies already installed', 'green');
  }

  // Step 3: Validate seed file
  log('\n📋 Validating seed configuration...', 'cyan');
  
  if (!fs.existsSync(SEED_FILE)) {
    log(`❌ Seed file not found: ${SEED_FILE}`, 'red');
    log('   Please create we-seed.json in the workspace root', 'yellow');
    process.exit(1);
  }

  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
    log('✅ Seed file is valid JSON', 'green');
  } catch (error) {
    log(`❌ Seed file is invalid JSON: ${error.message}`, 'red');
    process.exit(1);
  }

  // Validate seed structure
  if (!seed.apps || seed.apps.length === 0) {
    log('❌ Seed file must contain at least one app', 'red');
    process.exit(1);
  }

  if (!seed.ad4m || !seed.ad4m.executorPath) {
    log('❌ Seed file must contain ad4m.executorPath', 'red');
    process.exit(1);
  }

  if (!seed.ad4m.repoPath) {
    log('⚠️  Warning: ad4m.repoPath not set in seed file', 'yellow');
    log('   Tauri Cargo.toml generation may fail', 'yellow');
  }

  log(`✅ Found ${seed.apps.length} apps in seed file`, 'green');

  // Step 4: Check external dependencies
  log('\n🔍 Checking external dependencies...', 'cyan');

  let allDepsReady = true;

  // Check AD4M executor
  const ad4mExecutorPath = path.isAbsolute(seed.ad4m.executorPath)
    ? seed.ad4m.executorPath
    : path.resolve(WORKSPACE_ROOT, seed.ad4m.executorPath);

  if (checkFileExists(ad4mExecutorPath, 'AD4M executor binary')) {
    const stats = fs.statSync(ad4mExecutorPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(1);
    log(`   Size: ${sizeMB}MB`, 'blue');
  } else {
    allDepsReady = false;
    log('   To build AD4M:', 'yellow');
    log('   cd ../ad4m && cargo build --release', 'yellow');
  }

  // Check each app's dist folder
  for (const app of seed.apps) {
    const distPath = path.isAbsolute(app.paths.dist)
      ? app.paths.dist
      : path.resolve(WORKSPACE_ROOT, app.paths.dist);

    if (checkFileExists(distPath, `${app.name} dist folder`)) {
      // Count files in dist
      const files = fs.readdirSync(distPath);
      log(`   Files: ${files.length}`, 'blue');
    } else {
      allDepsReady = false;
      log(`   To build ${app.name}:`, 'yellow');
      log(`   cd ${app.paths.projectRoot} && ${app.commands.build}`, 'yellow');
    }
  }

  if (!allDepsReady) {
    log('\n⚠️  Some external dependencies are missing', 'yellow');
    log('Build them first, then run pnpm setup again', 'yellow');
    log('Or continue anyway if you only need web development', 'yellow');
    
    // Don't exit - let them continue for web-only dev
  }

  // Step 5: Build internal WE packages
  log('\n🏗️  Building internal WE packages...', 'cyan');
  log('This will build packages in dependency order:', 'blue');
  log('  1. @we/app-framework', 'blue');
  log('  2. @we/cli', 'blue');
  log('  3. Apps (we-web, we-electron, we-tauri)', 'blue');
  
  try {
    exec('pnpm -r build');
    log('✅ All internal packages built successfully', 'green');
  } catch (error) {
    log('❌ Failed to build internal packages', 'red');
    process.exit(1);
  }

  // Step 6: Generate platform configurations
  log('\n⚙️  Generating platform configurations...', 'cyan');

  // Generate Electron config
  const electronGenerator = path.join(WORKSPACE_ROOT, 'apps/we-electron/scripts/generate-seed-config.cjs');
  if (fs.existsSync(electronGenerator)) {
    try {
      exec(`node ${electronGenerator}`, { stdio: 'pipe' });
      log('✅ Electron configuration generated', 'green');
    } catch (error) {
      log('⚠️  Electron configuration generation failed', 'yellow');
    }
  }

  // Generate Tauri config
  const tauriGenerator = path.join(WORKSPACE_ROOT, 'apps/we-tauri/scripts/generate-seed-config.cjs');
  if (fs.existsSync(tauriGenerator)) {
    try {
      exec(`node ${tauriGenerator}`, { stdio: 'pipe' });
      log('✅ Tauri configuration generated', 'green');
    } catch (error) {
      log('⚠️  Tauri configuration generation failed', 'yellow');
    }
  }

  // Step 7: Success summary
  log('\n✨ Setup complete!\n', 'bright');
  log('📝 Next steps:', 'cyan');
  log('');
  log('  Development:', 'bright');
  log('    pnpm dev:web       - Start web development server', 'blue');
  log('    pnpm dev:electron  - Start Electron in development mode', 'blue');
  log('    pnpm dev:tauri     - Start Tauri in development mode', 'blue');
  log('');
  log('  Production builds:', 'bright');
  log('    pnpm build:web       - Build web distribution', 'blue');
  log('    pnpm build:electron  - Build Electron AppImage', 'blue');
  log('    pnpm build:tauri     - Build Tauri AppImage', 'blue');
  log('    pnpm build:all       - Build all distributions', 'blue');
  log('');
  log('🎉 Happy coding!\n', 'green');
}

// Run
main().catch((error) => {
  log(`\n❌ Setup failed: ${error.message}`, 'red');
  process.exit(1);
});
