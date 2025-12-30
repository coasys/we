#!/usr/bin/env node

/**
 * Tauri Seed Configuration Generator
 *
 * Reads we-seed.json and generates:
 * 1. Resource mappings for tauri.conf.json
 * 2. Rust code for serving multiple apps
 * 3. Port map for the Tauri adapter
 *
 * This ensures a single source of truth (the seed file) for all platform configurations.
 */

const fs = require('fs');
const path = require('path');

// Paths
const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');
const SEED_FILE = path.join(WORKSPACE_ROOT, 'we-seed.json');
const OUTPUT_DIR = path.join(__dirname, '../src-tauri/src/generated');
const SRC_GENERATED_DIR = path.join(__dirname, '../src/generated');
const TAURI_CONF_FILE = path.join(__dirname, '../src-tauri/tauri.conf.json');
const CARGO_TOML_TEMPLATE = path.join(__dirname, '../src-tauri/Cargo.toml.template');
const CARGO_TOML_OUTPUT = path.join(__dirname, '../src-tauri/Cargo.toml');
const PORT_MAP_FILE = path.join(OUTPUT_DIR, 'seed-port-map.json');
const PORT_MAP_FILE_WEB = path.join(SRC_GENERATED_DIR, 'seed-port-map.json');

function main() {
  console.log('🔧 Generating Tauri seed configuration...\n');

  // Read seed file
  if (!fs.existsSync(SEED_FILE)) {
    console.error(`❌ Seed file not found: ${SEED_FILE}`);
    process.exit(1);
  }

  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));

  if (!seed.apps || seed.apps.length === 0) {
    console.log('ℹ️  No apps defined - native WE app mode (no embedded apps)');
    console.log('✅ No Tauri configuration needed for native mode\n');

    // Generate minimal Cargo.toml for native mode
    if (fs.existsSync(CARGO_TOML_TEMPLATE) && seed.ad4m?.repoPath) {
      const template = fs.readFileSync(CARGO_TOML_TEMPLATE, 'utf8');

      const absoluteAd4mPath = path.isAbsolute(seed.ad4m.repoPath)
        ? seed.ad4m.repoPath
        : path.resolve(WORKSPACE_ROOT, seed.ad4m.repoPath);

      const SRC_TAURI_DIR = path.join(__dirname, '..', 'src-tauri');
      const relativeAd4mPath = path.relative(SRC_TAURI_DIR, absoluteAd4mPath);

      // Replace template placeholders
      const ad4mClientPath = path.join(relativeAd4mPath, 'rust-client');
      const ad4mExecutorPath = path.join(relativeAd4mPath, 'rust-executor');

      const cargoToml = template
        .replace(/\{\{AD4M_CLIENT_PATH\}\}/g, ad4mClientPath)
        .replace(/\{\{AD4M_EXECUTOR_PATH\}\}/g, ad4mExecutorPath);

      fs.writeFileSync(CARGO_TOML_OUTPUT, cargoToml);
      console.log(`✅ Cargo.toml generated from template`);
      console.log(`   AD4M client: ${ad4mClientPath}`);
      console.log(`   AD4M executor: ${ad4mExecutorPath}`);
    }

    // Ensure output directories exist
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }
    if (!fs.existsSync(SRC_GENERATED_DIR)) {
      fs.mkdirSync(SRC_GENERATED_DIR, { recursive: true });
    }

    // Create empty config files so build doesn't fail
    fs.writeFileSync(PORT_MAP_FILE, JSON.stringify({}, null, 2));
    fs.writeFileSync(PORT_MAP_FILE_WEB, JSON.stringify({}, null, 2));

    console.log('✅ Minimal configuration files generated');
    return;
  }

  console.log(`📦 Found ${seed.apps.length} apps in seed file:`);
  seed.apps.forEach((app, i) => {
    console.log(`   ${i + 1}. ${app.name} (${app.id})`);
  });
  console.log();

  // Get base port from seed file or use default
  const BASE_PORT = seed.tauri?.basePort || 8080;

  // Generate port mappings (sequential assignment)
  const portMap = {};
  seed.apps.forEach((app, index) => {
    portMap[app.id] = BASE_PORT + index;
  });

  console.log('🔌 Port assignments:');
  Object.entries(portMap).forEach(([id, port]) => {
    console.log(`   ${id}: ${port}`);
  });
  console.log();

  // Generate Tauri bundle resources
  // Paths in tauri.conf.json must be relative to the src-tauri directory
  const SRC_TAURI_DIR = path.join(__dirname, '..', 'src-tauri');
  const bundleResources = {};

  seed.apps.forEach((app) => {
    // Convert workspace-relative path to absolute, then to src-tauri-relative
    const absolutePath = path.isAbsolute(app.paths.dist) ? app.paths.dist : path.join(WORKSPACE_ROOT, app.paths.dist);

    const relativeFromSrcTauri = path.relative(SRC_TAURI_DIR, absolutePath);
    bundleResources[relativeFromSrcTauri] = app.id;
  });

  // Add static resources
  if (seed.tauri?.appDistPath) {
    const TAURI_ROOT = path.join(__dirname, '..');
    const absoluteAppDist = path.join(TAURI_ROOT, seed.tauri.appDistPath);
    const relativeFromSrcTauri = path.relative(SRC_TAURI_DIR, absoluteAppDist);
    bundleResources[relativeFromSrcTauri] = 'app';
  }

  // Note: ad4m-executor is NOT bundled as a resource for Tauri
  // Tauri links to ad4m-executor as a Rust library dependency in Cargo.toml
  // Only Electron needs to bundle it as a separate executable

  console.log('📁 Bundle resources configuration:');
  Object.entries(bundleResources).forEach(([from, to]) => {
    console.log(`   ${from} → ${to}`);
  });
  console.log();

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write port map JSON (both in src-tauri/generated and src/generated for Vite access)
  fs.writeFileSync(PORT_MAP_FILE, JSON.stringify(portMap, null, 2), 'utf8');
  console.log(`✅ Port map written to: ${path.relative(process.cwd(), PORT_MAP_FILE)}`);

  // Also write to src/generated for Vite/frontend access
  if (!fs.existsSync(SRC_GENERATED_DIR)) {
    fs.mkdirSync(SRC_GENERATED_DIR, { recursive: true });
  }
  fs.writeFileSync(PORT_MAP_FILE_WEB, JSON.stringify(portMap, null, 2), 'utf8');
  console.log(`✅ Port map (frontend) written to: ${path.relative(process.cwd(), PORT_MAP_FILE_WEB)}`);

  // Write bundle resources JSON
  const BUNDLE_RESOURCES_FILE = path.join(OUTPUT_DIR, 'seed-bundle-resources.json');
  fs.writeFileSync(BUNDLE_RESOURCES_FILE, JSON.stringify(bundleResources, null, 2), 'utf8');
  console.log(`✅ Bundle resources written to: ${path.relative(process.cwd(), BUNDLE_RESOURCES_FILE)}`);

  // Generate Rust app server code
  const appServerCode = generateAppServerCode(seed.apps, portMap);
  const APP_SERVER_FILE = path.join(OUTPUT_DIR, 'seed_servers.rs');
  fs.writeFileSync(APP_SERVER_FILE, appServerCode, 'utf8');
  console.log(`✅ App server code written to: ${path.relative(process.cwd(), APP_SERVER_FILE)}`);

  // Generate mod.rs to export the generated module
  const MOD_RS_FILE = path.join(OUTPUT_DIR, 'mod.rs');
  const modRsContent = `// Generated seed server module
mod seed_servers;

pub use seed_servers::setup_seed_servers;
`;
  fs.writeFileSync(MOD_RS_FILE, modRsContent, 'utf8');
  console.log(`✅ Module file written to: ${path.relative(process.cwd(), MOD_RS_FILE)}`);

  // Generate Cargo.toml from template with AD4M paths
  if (fs.existsSync(CARGO_TOML_TEMPLATE)) {
    let cargoTemplate = fs.readFileSync(CARGO_TOML_TEMPLATE, 'utf8');

    if (seed.ad4m?.repoPath) {
      const absoluteAd4mPath = path.isAbsolute(seed.ad4m.repoPath)
        ? seed.ad4m.repoPath
        : path.resolve(WORKSPACE_ROOT, seed.ad4m.repoPath);

      const SRC_TAURI_DIR = path.join(__dirname, '..', 'src-tauri');
      const relativeAd4mPath = path.relative(SRC_TAURI_DIR, absoluteAd4mPath);

      // Replace template placeholders
      const ad4mClientPath = path.join(relativeAd4mPath, 'rust-client');
      const ad4mExecutorPath = path.join(relativeAd4mPath, 'rust-executor');

      cargoTemplate = cargoTemplate
        .replace('{{AD4M_CLIENT_PATH}}', ad4mClientPath)
        .replace('{{AD4M_EXECUTOR_PATH}}', ad4mExecutorPath);

      fs.writeFileSync(CARGO_TOML_OUTPUT, cargoTemplate, 'utf8');
      console.log(`✅ Cargo.toml generated from template`);
      console.log(`   AD4M client: ${ad4mClientPath}`);
      console.log(`   AD4M executor: ${ad4mExecutorPath}`);
    } else {
      console.warn('⚠️  No ad4m.repoPath in seed file, Cargo.toml not updated');
    }
  }

  // Update tauri.conf.json
  updateTauriConfig(bundleResources);

  console.log('\n✨ Tauri seed configuration generated successfully!');
  console.log('\n📝 Next steps:');
  console.log('   1. The bundle resources in tauri.conf.json have been updated');
  console.log('   2. Update lib.rs to use the generated seed_servers.rs');
  console.log('   3. Build with: pnpm tauri:build');
}

function generateAppServerCode(apps, portMap) {
  const serverSetup = apps
    .map((app) => {
      const port = portMap[app.id];
      return `    // ${app.name} (${app.id})
    let app_${app.id}_dir = resource_path.join("${app.id}");
    if app_${app.id}_dir.exists() {
        println!("📦 Starting ${app.name} server on port ${port}");
        std::thread::spawn(move || {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .thread_name(String::from("app_server_${app.id}"))
                .enable_all()
                .build()
                .unwrap();
            runtime.block_on(serve_static_app(${port}, app_${app.id}_dir));
        });
    } else {
        eprintln!("⚠️  ${app.name} directory not found at {:?}", app_${app.id}_dir);
    }`;
    })
    .join('\n\n');

  return `// Auto-generated Seed Server Setup for Tauri
// 
// This file is generated by scripts/generate-seed-config.cjs
// Do not edit manually - changes will be overwritten!

use std::path::PathBuf;
use crate::app_server::serve_static_app;

/// Setup HTTP servers for all apps from seed configuration
/// 
/// In production: Serves from bundled resources
pub fn setup_seed_servers(resource_path: PathBuf) {
${serverSetup}
}
`;
}

function updateTauriConfig(bundleResources) {
  try {
    const config = JSON.parse(fs.readFileSync(TAURI_CONF_FILE, 'utf8'));

    // Update bundle resources
    config.bundle = config.bundle || {};
    config.bundle.resources = bundleResources;

    fs.writeFileSync(TAURI_CONF_FILE, JSON.stringify(config, null, 2), 'utf8');
    console.log(`✅ Updated tauri.conf.json with generated resources`);
  } catch (error) {
    console.error(`❌ Failed to update tauri.conf.json:`, error.message);
  }
}

// Run
main();
