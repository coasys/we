#!/usr/bin/env node

/**
 * Electron Seed Configuration Generator
 * 
 * Reads we-seed.json and generates:
 * 1. Port mappings for production Express servers
 * 2. extraResources configuration for package.json
 * 3. Express server setup code for main.js
 * 
 * This ensures a single source of truth (the seed file) for all platform configurations.
 */

const fs = require('fs');
const path = require('path');

// Paths
const WORKSPACE_ROOT = path.resolve(__dirname, '../../..');
const SEED_FILE = path.join(WORKSPACE_ROOT, 'we-seed.json');
const OUTPUT_DIR = path.join(__dirname, '../electron');
const PORT_MAP_FILE = path.join(OUTPUT_DIR, 'seed-port-map.json');
const EXTRA_RESOURCES_FILE = path.join(OUTPUT_DIR, 'seed-extra-resources.json');

function main() {
  console.log('🔧 Generating Electron seed configuration...\n');

  // Read seed file
  if (!fs.existsSync(SEED_FILE)) {
    console.error(`❌ Seed file not found: ${SEED_FILE}`);
    process.exit(1);
  }

  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'));
  
  if (!seed.apps || seed.apps.length === 0) {
    console.log('ℹ️  No apps defined - native WE app mode (no embedded apps)');
    console.log('✅ No Electron configuration needed for native mode\n');
    
    // Create empty config files so build doesn't fail
    fs.writeFileSync(PORT_MAP_FILE, JSON.stringify({}, null, 2));
    fs.writeFileSync(EXTRA_RESOURCES_FILE, JSON.stringify({ extraResources: [] }, null, 2));
    
    console.log('✅ Empty configuration files generated');
    return;
  }

  console.log(`📦 Found ${seed.apps.length} apps in seed file:`);
  seed.apps.forEach((app, i) => {
    console.log(`   ${i + 1}. ${app.name} (${app.id})`);
  });
  console.log();

  // Get base port from seed file or use default
  const BASE_PORT = seed.electron?.basePort || 8080;

  // Generate port mappings
  const portMap = {};
  seed.apps.forEach((app, index) => {
    portMap[app.id] = BASE_PORT + index;
  });

  console.log('🔌 Port assignments:');
  Object.entries(portMap).forEach(([id, port]) => {
    console.log(`   ${id}: ${port}`);
  });
  console.log();

  // Generate extraResources configuration
  const extraResources = seed.apps.map((app) => {
    // Resolve the dist path relative to workspace root
    const distPath = path.isAbsolute(app.paths.dist) 
      ? app.paths.dist 
      : path.join(WORKSPACE_ROOT, app.paths.dist);
    
    // Make it relative to we-electron directory for package.json
    const relativeFromElectron = path.relative(
      path.join(__dirname, '..'),
      distPath
    );

    return {
      from: relativeFromElectron,
      to: app.id, // Use app ID as the resource folder name
      filter: ['**/*']
    };
  });

  // Add static resources from seed file configuration
  const staticResources = [];
  
  // Add we-electron app dist if specified in seed
  if (seed.electron?.appDistPath) {
    staticResources.push({
      from: seed.electron.appDistPath,
      to: 'app/dist',
      filter: ['**/*']
    });
  }
  
  // Add AD4M executor if specified in seed
  if (seed.ad4m?.executorPath) {
    // Convert path from workspace-relative to we-electron-relative
    const executorPath = path.isAbsolute(seed.ad4m.executorPath)
      ? seed.ad4m.executorPath
      : path.relative(
          path.join(__dirname, '..'),
          path.join(WORKSPACE_ROOT, seed.ad4m.executorPath)
        );
    
    staticResources.push({
      from: executorPath,
      to: 'ad4m-executor'
    });
  }

  // Merge static and generated resources
  const allExtraResources = [...staticResources, ...extraResources];

  console.log('📁 extraResources configuration:');
  extraResources.forEach((resource) => {
    console.log(`   ${resource.from} → ${resource.to}`);
  });
  console.log();

  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  // Write port map
  fs.writeFileSync(
    PORT_MAP_FILE,
    JSON.stringify(portMap, null, 2),
    'utf8'
  );
  console.log(`✅ Port map written to: ${path.relative(process.cwd(), PORT_MAP_FILE)}`);

  // Write extraResources
  fs.writeFileSync(
    EXTRA_RESOURCES_FILE,
    JSON.stringify(allExtraResources, null, 2),
    'utf8'
  );
  console.log(`✅ extraResources written to: ${path.relative(process.cwd(), EXTRA_RESOURCES_FILE)}`);

  // Generate Express server setup code
  const serverSetupCode = generateServerSetupCode(seed.apps, portMap);
  const SERVER_SETUP_FILE = path.join(OUTPUT_DIR, 'seed-servers.js');
  
  fs.writeFileSync(SERVER_SETUP_FILE, serverSetupCode, 'utf8');
  console.log(`✅ Server setup code written to: ${path.relative(process.cwd(), SERVER_SETUP_FILE)}`);

  console.log('\n✨ Seed configuration generated successfully!');
  console.log('\n📝 Next steps:');
  console.log('   1. The extraResources in package.json build config will be read from seed-extra-resources.json');
  console.log('   2. Import setupSeedServers() from ./seed-servers.js in main.js and call it');
  console.log('   3. Build with: pnpm electron:build');
}

function generateServerSetupCode(apps, portMap) {
  return `/**
 * Auto-generated Seed Server Setup
 * 
 * This file is generated by scripts/generate-seed-config.js
 * Do not edit manually - changes will be overwritten!
 * 
 * Sets up Express servers for each app defined in we-seed.json
 */

import express from 'express';
import { app } from 'electron';
import { existsSync } from 'fs';
import { join } from 'path';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Setup Express servers for all apps from seed configuration
 * 
 * In development: Serves from dist paths in workspace
 * In production: Serves from bundled resources
 * 
 * @returns {Array} Array of Express server instances
 */
export function setupSeedServers() {
  const servers = [];

${apps.map((appConfig) => {
  const port = portMap[appConfig.id];
  return `  // ${appConfig.name} (${appConfig.id})
  const ${appConfig.id}Dir = app.isPackaged
    ? join(process.resourcesPath, '${appConfig.id}')
    : join(__dirname, '..', '..', '..', '${appConfig.paths.dist}');

  if (existsSync(${appConfig.id}Dir)) {
    console.log('📦 Starting ${appConfig.name} server on http://localhost:${port}');
    console.log('   Serving from:', ${appConfig.id}Dir);

    const ${appConfig.id}App = express();
    ${appConfig.id}App.use(express.static(${appConfig.id}Dir, {
      setHeaders: (res) => {
        res.removeHeader('X-Frame-Options');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      },
    }));
    
    // Fallback to index.html for SPA routing
    ${appConfig.id}App.use((req, res) => {
      res.sendFile(join(${appConfig.id}Dir, 'index.html'));
    });
    
    const ${appConfig.id}Server = ${appConfig.id}App.listen(${port}, () => {
      console.log('   ✓ ${appConfig.name} server listening on port ${port}');
    });
    
    servers.push(${appConfig.id}Server);
  } else {
    console.warn('⚠️  ${appConfig.name} directory not found at:', ${appConfig.id}Dir);
  }
`;
}).join('\n')}
  return servers;
}
`;
}

// Run
main();
