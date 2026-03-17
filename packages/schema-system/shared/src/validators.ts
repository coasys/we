import { z } from 'zod';

import { zSchemaNode, zTemplateSchema } from './zodSchemas';

export type ValidationError = { path: string; message: string };
export type ValidationResult = { valid: boolean; errors: ValidationError[] };

// Utility function to convert Zod errors to our `ValidationError` format
// function zodErrorToValidationErrors(zodErrors: z.ZodError): ValidationError[] {
//   console.log(JSON.stringify(z.treeifyError(zodErrors), null, 2));
//   return zodErrors.issues.map((issue) => ({
//     path: issue.path.join('.'),
//     message: issue.message,
//   }));
// }

function zodErrorToValidationErrors(zodErrors: z.ZodError): ValidationError[] {
  const tree = z.treeifyError(zodErrors);
  const out: ValidationError[] = [];

  function walk(node: any, path: (string | number)[] = []) {
    if (!node) return;

    // emit node-level errors
    if (Array.isArray(node.errors) && node.errors.length > 0) {
      for (const msg of node.errors) {
        out.push({ path: path.map(String).join('.'), message: msg });
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
      node.items.forEach((item: any, idx: number) => walk(item, [...path, idx]));
    }
  }

  walk(tree);

  if (out.length === 0) {
    // fallback: include full tree for debugging
    out.push({ path: '', message: JSON.stringify(tree, null, 2) });
  }

  return out;
}

// Validate a single SchemaNode using Zod
export function validateNode(node: unknown): ValidationResult {
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
export function validateSchema(schema: unknown): ValidationResult {
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
