import type { WeSeedFile, SeedMetadata } from '../types/seed';
import { validateSeed } from './validator';

/**
 * Processes a seed file and generates integration code
 */
export class SeedProcessor {
  constructor(private seed: WeSeedFile) {
    const validation = validateSeed(seed);
    if (!validation.valid) {
      throw new Error(`Invalid seed file: ${validation.errors?.map(e => e.message).join(', ')}`);
    }
  }

  /**
   * Generate a unique integration ID from the project name
   */
  private generateIntegrationId(): string {
    return this.seed.project.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Generate a camelCase variable name from the integration ID
   */
  private generateVariableName(): string {
    const id = this.generateIntegrationId();
    return id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  /**
   * Generate schema definitions for the integration
   */
  generateSchemas(): Record<string, any> {
    const schemas: Record<string, any> = {};

    // Generate main app schema
    schemas.main = {
      type: 'container',
      props: {
        class: `we-integration we-integration-${this.generateIntegrationId()}`,
      },
      children: [
        {
          type: 'text',
          content: `Loading ${this.seed.project.name}...`,
        },
      ],
    };

    return schemas;
  }

  /**
   * Generate route configurations
   */
  generateRoutes(): Array<{ path: string; component: string }> {
    const routes: Array<{ path: string; component: string }> = [];

    // Routes from apps
    this.seed.apps.forEach(app => {
      routes.push({
        path: app.route,
        component: 'main',
      });
    });

    return routes;
  }

  /**
   * Generate integration metadata
   */
  generateMetadata(): SeedMetadata {
    const integrationId = this.generateIntegrationId();

    return {
      seed: this.seed,
      processedAt: new Date().toISOString(),
      integrationId,
      outputPaths: {
        schema: `packages/app-framework/src/shared/schemas/integrations/${integrationId}/schemas.ts`,
        components: `packages/app-framework/src/shared/schemas/integrations/${integrationId}/components.ts`,
        routes: `packages/app-framework/src/shared/schemas/integrations/${integrationId}/routes.ts`,
      },
    };
  }

  /**
   * Generate TypeScript code for schema file
   */
  generateSchemaCode(): string {
    const schemas = this.generateSchemas();
    const variableName = this.generateVariableName();

    return `/**
 * Generated from WE seed file for ${this.seed.project.name}
 * Version: ${this.seed.project.version}
 * Generated at: ${new Date().toISOString()}
 * 
 * DO NOT EDIT MANUALLY - This file is auto-generated
 */

export const ${variableName}Schemas = ${JSON.stringify(schemas, null, 2)};
`;
  }

  /**
   * Generate TypeScript code for routes file
   */
  generateRoutesCode(): string {
    const routes = this.generateRoutes();
    const variableName = this.generateVariableName();

    return `/**
 * Generated from WE seed file for ${this.seed.project.name}
 * Version: ${this.seed.project.version}
 * Generated at: ${new Date().toISOString()}
 * 
 * DO NOT EDIT MANUALLY - This file is auto-generated
 */

export const ${variableName}Routes = ${JSON.stringify(routes, null, 2)};
`;
  }

  /**
   * Generate integration manifest
   */
  generateManifest(): string {
    const integrationId = this.generateIntegrationId();
    const variableName = this.generateVariableName();

    // Collect capabilities from all apps
    const allCapabilities = Array.from(
      new Set(this.seed.apps.flatMap(app => app.capabilities))
    );

    const manifest = {
      id: integrationId,
      name: this.seed.project.name,
      version: this.seed.project.version,
      description: this.seed.project.description,
      author: this.seed.project.author,
      apps: this.seed.apps.map(app => ({
        id: app.id,
        name: app.name,
        route: app.route,
        capabilities: app.capabilities,
      })),
      capabilities: allCapabilities,
    };

    return `/**
 * Integration manifest for ${this.seed.project.name}
 * Generated at: ${new Date().toISOString()}
 * 
 * DO NOT EDIT MANUALLY - This file is auto-generated
 */

export const ${variableName}Manifest = ${JSON.stringify(manifest, null, 2)};
`;
  }

  /**
   * Process the seed file and return all generated code
   */
  process(): {
    metadata: SeedMetadata;
    files: {
      schemas: string;
      routes: string;
      manifest: string;
    };
  } {
    return {
      metadata: this.generateMetadata(),
      files: {
        schemas: this.generateSchemaCode(),
        routes: this.generateRoutesCode(),
        manifest: this.generateManifest(),
      },
    };
  }
}

/**
 * Process a seed file and generate integration code
 */
export async function processSeed(seed: WeSeedFile): Promise<ReturnType<SeedProcessor['process']>> {
  const processor = new SeedProcessor(seed);
  return processor.process();
}
