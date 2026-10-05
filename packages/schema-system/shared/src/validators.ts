import { z } from 'zod';

import { zSchemaNode, zTemplateSchema } from './zodSchemas';

export type ValidationError = { path: string; message: string; severity: 'error' | 'warning' };
export type ValidationResult = { valid: boolean; errors: ValidationError[] };

type Issue = z.core.$ZodIssue;
type Path = readonly PropertyKey[];

/**
 * How far into the value an issue is, counting into the branches of a union it reports: a union two
 * keys down whose best branch got one key further reaches three.
 */
function reach(issue: Issue): number {
  if (issue.code !== 'invalid_union' || !issue.errors.length) return issue.path.length;
  return issue.path.length + Math.max(...issue.errors.map(progress));
}

/**
 * How far a union branch got before it failed: the reach of its shallowest issue. A branch that is
 * not what the value was meant to be fails at once (the wrong type, keys it does not know, a fallback
 * refusing the whole value), so it scores 0; the branch the value was meant to be fails somewhere
 * inside it.
 */
function progress(branch: readonly Issue[]): number {
  return branch.length ? Math.min(...branch.map(reach)) : 0;
}

/**
 * The issues worth reporting, with each failed union narrowed to the branches that got furthest.
 *
 * A child is a node, a string or a token, and a prop is any of those or a plain object. When a node
 * fails, zod reports every branch it tried, in the order they were declared, which puts "expected
 * string", "expected number" and a line of "unrecognized keys" per token kind ahead of the node's own
 * fault. A caller printing the first five lines printed only those, so the reason a template was
 * refused never appeared.
 *
 * The branches kept are those that got furthest into the value before failing, which is the node
 * wherever the node was meant: it fails inside itself, and everything else fails at its door. Where
 * the furthest is shared (a value no branch got into at all) every one of those is reported, since
 * nothing says which was meant.
 */
function flattenIssues(issues: readonly Issue[], prefix: Path = []): { path: Path; message: string }[] {
  return issues.flatMap((issue) => {
    // A branch's issues are relative to the union. Joined once here, so a nested union compounds.
    const path = [...prefix, ...issue.path];
    if (issue.code !== 'invalid_union' || !issue.errors.length) return [{ path, message: issue.message }];
    const best = Math.max(...issue.errors.map(progress));
    return issue.errors.filter((branch) => progress(branch) === best).flatMap((branch) => flattenIssues(branch, path));
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
