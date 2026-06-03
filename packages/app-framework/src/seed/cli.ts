#!/usr/bin/env node

/**
 * WE Seed CLI
 *
 * Command-line tool for processing WE seed files and generating integrations
 */

import * as fs from 'fs/promises';
import * as path from 'path';

import { loadSeed, processSeed, validateSeed } from './index';

interface CliOptions {
  seedPath: string;
  output?: string;
  validate?: boolean;
  verbose?: boolean;
}

async function parseArgs(): Promise<CliOptions> {
  const args = process.argv.slice(2);

  const options: CliOptions = {
    seedPath: '',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '--output':
      case '-o':
        options.output = args[++i];
        break;
      case '--validate':
      case '-v':
        options.validate = true;
        break;
      case '--verbose':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (!options.seedPath && !arg.startsWith('-')) {
          options.seedPath = arg;
        }
    }
  }

  if (!options.seedPath) {
    console.error('Error: Seed file path is required');
    printHelp();
    process.exit(1);
  }

  return options;
}

function printHelp() {
  console.log(`
WE Seed CLI - Generate WE integrations from seed files

Usage:
  we-seed <seed-file> [options]

Options:
  -o, --output <dir>    Output directory for generated files
  -v, --validate        Only validate the seed file without generating
  --verbose             Enable verbose logging
  -h, --help            Show this help message

Examples:
  # Validate a seed file
  we-seed ./we-seed.json --validate

  # Generate integration code
  we-seed ./we-seed.json --output ./packages/app-framework/src/shared/schemas/integrations

  # Process with verbose output
  we-seed ./we-seed.json --verbose
  `);
}

async function run() {
  try {
    const options = await parseArgs();

    if (options.verbose) {
      console.log('Loading seed file:', options.seedPath);
    }

    // Load and validate seed file
    const seed = await loadSeed(options.seedPath);

    if (options.validate) {
      const validation = validateSeed(seed);

      if (validation.valid) {
        console.log('✓ Seed file is valid');

        if (validation.warnings && validation.warnings.length > 0) {
          console.log('\nWarnings:');
          validation.warnings.forEach((w) => {
            console.log(`  ⚠ ${w.path}: ${w.message}`);
          });
        }
      } else {
        console.error('✗ Seed file is invalid\n');
        validation.errors?.forEach((e) => {
          console.error(`  ✗ ${e.path}: ${e.message}`);
        });
        process.exit(1);
      }

      return;
    }

    // Process seed file
    if (options.verbose) {
      console.log('Processing seed file...');
    }

    const result = await processSeed(seed);

    if (options.verbose) {
      console.log('Generated integration:', result.metadata.integrationId);
    }

    // Write output files
    const outputDir =
      options.output ||
      path.join(process.cwd(), 'packages/app-framework/src/shared/schemas/integrations', result.metadata.integrationId);

    await fs.mkdir(outputDir, { recursive: true });

    // Write schema file
    const schemaPath = path.join(outputDir, 'schemas.ts');
    await fs.writeFile(schemaPath, result.files.schemas);
    if (options.verbose) {
      console.log('Created:', schemaPath);
    }

    // Write routes file
    const routesPath = path.join(outputDir, 'routes.ts');
    await fs.writeFile(routesPath, result.files.routes);
    if (options.verbose) {
      console.log('Created:', routesPath);
    }

    // Write manifest file
    const manifestPath = path.join(outputDir, 'manifest.ts');
    await fs.writeFile(manifestPath, result.files.manifest);
    if (options.verbose) {
      console.log('Created:', manifestPath);
    }

    // Write metadata
    const metadataPath = path.join(outputDir, 'metadata.json');
    await fs.writeFile(metadataPath, JSON.stringify(result.metadata, null, 2));
    if (options.verbose) {
      console.log('Created:', metadataPath);
    }

    console.log(`\n✓ Integration generated successfully!`);
    console.log(`  ID: ${result.metadata.integrationId}`);
    console.log(`  Apps: ${seed.apps.map((a) => a.name).join(', ')}`);
    console.log(`  Output: ${outputDir}`);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run CLI
run();
