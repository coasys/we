import type { Props } from './types';

// Resolves $expr props: { $expr: 'space.name' } or { $expr: '`/space/${space.uuid}`' }
export function resolveExpressionProp(value: unknown, context: Props): unknown {
  try {
    // Create a function with context keys as arguments
    const expression = (value as { $expr: string }).$expr;
    const argNames = Object.keys(context);
    const argValues = Object.values(context);
    const fn = new Function(...argNames, `return (${expression});`);

    // Call the function with context values to evaluate the expression
    return fn(...argValues);
  } catch (e) {
    console.error('Error evaluating $expr:', value, context, e);
    return undefined;
  }
}
