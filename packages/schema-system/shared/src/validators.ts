import { z } from 'zod';

import { zSchemaNode, zTemplateSchema } from './zodSchemas';

export type ValidationError = { path: string; message: string; severity: 'error' | 'warning' };
export type ValidationResult = { valid: boolean; errors: ValidationError[] };

function zodErrorToValidationErrors(zodErrors: z.ZodError): ValidationError[] {
  const tree = z.treeifyError(zodErrors);
  const out: ValidationError[] = [];

  function walk(node: Record<string, unknown>, path: (string | number)[] = []) {
    if (!node) return;

    // emit node-level errors
    if (Array.isArray(node.errors) && node.errors.length > 0) {
      for (const msg of node.errors) {
        out.push({ path: path.map(String).join('.'), message: msg, severity: 'error' });
      }
    }

    // recur into object properties
    if (node.properties && typeof node.properties === 'object') {
      for (const [key, child] of Object.entries(node.properties)) {
        walk(child, [...path, key]);
      }
    }

    // recur into array items
    if (Array.isArray(node.items)) {
      node.items.forEach((item: Record<string, unknown>, idx: number) => walk(item, [...path, idx]));
    }
  }

  walk(tree);

  if (out.length === 0) {
    // fallback: include full tree for debugging
    out.push({ path: '', message: JSON.stringify(tree, null, 2), severity: 'error' });
  }

  return out;
}

// Validate a single SchemaNode using Zod
export function validateNodeStructure(node: unknown): ValidationResult {
  try {
    zSchemaNode.parse(node); // Zod runtime validation
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { valid: false, errors: zodErrorToValidationErrors(error) };
    }
    throw error; // Re-throw unexpected errors
  }
}

// Validate the entire TemplateSchema using Zod
export function validateStructure(schema: unknown): ValidationResult {
  try {
    zTemplateSchema.parse(schema); // Zod runtime validation
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { valid: false, errors: zodErrorToValidationErrors(error) };
    }
    throw error; // Re-throw unexpected errors
  }
}
