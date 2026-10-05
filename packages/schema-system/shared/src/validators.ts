import { z } from 'zod';

import { zSchemaNode, zTemplateSchema } from './zodSchemas';

export type ValidationError = { path: string; message: string; severity: 'error' | 'warning' };
export type ValidationResult = { valid: boolean; errors: ValidationError[] };

type Issue = z.core.$ZodIssue;
type Path = readonly PropertyKey[];

/**
 * Whether a union branch failed on the value's shape itself, at the union's own position: the
 * wrong type outright, or keys it does not recognise at all. Such a branch is not the one the
 * value was meant to be, so what it says about the value is noise. A branch that is itself a union
 * (`$setLocal` has two forms) rejects the shape when every one of its own branches does.
 */
function rejectsTheShape(branch: readonly Issue[]): boolean {
  return branch.some((issue) => {
    if (issue.path.length !== 0) return false;
    if (issue.code === 'invalid_type' || issue.code === 'unrecognized_keys') return true;
    return issue.code === 'invalid_union' && issue.errors.length > 0 && issue.errors.every(rejectsTheShape);
  });
}

/**
 * The issues worth reporting, with each failed union narrowed to the branch the value was meant to
 * be.
 *
 * A child is a node, a string or a token, and when a node fails zod reports every branch it tried.
 * In the order they were declared, which puts "expected string" and a line of "unrecognized keys"
 * per token kind ahead of the node's own fault. A caller showing the first five lines then showed
 * only those, and the reason the template was refused never appeared.
 *
 * The branch kept is the one that accepted the value's shape. When no branch did, or more than one
 * did, nothing can be said about which was meant, and every branch is reported as before.
 */
function flattenIssues(issues: readonly Issue[], prefix: Path = []): { path: Path; message: string }[] {
  return issues.flatMap((issue) => {
    // A branch's issues are relative to the union. Joined once here, so a nested union compounds.
    const path = [...prefix, ...issue.path];
    if (issue.code !== 'invalid_union' || !issue.errors.length) return [{ path, message: issue.message }];
    const plausible = issue.errors.filter((branch) => !rejectsTheShape(branch));
    const branches = plausible.length === 1 ? plausible : issue.errors;
    return branches.flatMap((branch) => flattenIssues(branch, path));
  });
}

function zodErrorToValidationErrors(zodErrors: z.ZodError): ValidationError[] {
  const seen = new Set<string>();
  const out: ValidationError[] = [];
  for (const { path, message } of flattenIssues(zodErrors.issues)) {
    const joined = path.map(String).join('.');
    const key = `${joined}\u0000${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path: joined, message, severity: 'error' });
  }
  return out;
}

// Auto-detect and validate: TemplateSchema (has meta) or SchemaNode fragment
export function validateStructure(schema: unknown): ValidationResult {
  const isTemplate = typeof schema === 'object' && schema !== null && 'meta' in schema;
  const zod = isTemplate ? zTemplateSchema : zSchemaNode;
  try {
    zod.parse(schema);
    return { valid: true, errors: [] };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { valid: false, errors: zodErrorToValidationErrors(error) };
    }
    throw error;
  }
}
