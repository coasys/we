import { describe, expect, it } from 'vitest';

import type { ContextData } from '../src/contextTypes';
import type { ValidationContext } from '../src/semanticValidation';
import { buildValidationContext, validateSchema, validateSemantic } from '../src/semanticValidation';

// ── Test helpers ───────────────────────────────────────────────────

function makeContext(overrides?: Partial<ContextData>): ContextData {
  return {
    primitives: [
      {
        tagName: 'we-button',
        className: 'Button',
        superclass: 'DesignSystemElement',
        ownProps: [
          { name: 'text', type: 'string', optional: true },
          { name: 'variant', type: 'ButtonVariant', optional: true },
          { name: 'disabled', type: 'boolean', optional: true },
          { name: 'loading', type: 'boolean', optional: true },
        ],
      },
      {
        tagName: 'we-text',
        className: 'Text',
        superclass: 'DesignSystemElement',
        ownProps: [
          { name: 'tag', type: 'string', optional: true },
          { name: 'inline', type: 'boolean', optional: true },
        ],
      },
      {
        tagName: 'we-icon',
        className: 'Icon',
        superclass: 'LayoutElement',
        ownProps: [
          { name: 'name', type: 'string', optional: false },
          { name: 'size', type: 'string', optional: true },
          { name: 'color', type: 'string', optional: true },
        ],
      },
      {
        tagName: 'we-spinner',
        className: 'Spinner',
        superclass: 'LayoutElement',
        ownProps: [{ name: 'size', type: 'string', optional: true }],
      },
    ],
    components: [
      {
        name: 'Column',
        props: [
          { name: 'gap', type: 'string', optional: true },
          { name: 'width', type: 'string', optional: true },
          { name: 'height', type: 'string', optional: true },
          { name: 'ax', type: 'string', optional: true },
          { name: 'ay', type: 'string', optional: true },
          { name: 'bg', type: 'string', optional: true },
        ],
        source: 'components',
      },
      {
        name: 'Row',
        props: [
          { name: 'gap', type: 'string', optional: true },
          { name: 'ay', type: 'string', optional: true },
        ],
        source: 'components',
      },
    ],
    models: [
      { name: 'TaskBlock', className: 'TaskBlock', fields: [], relations: [] },
      { name: 'PostBlock', className: 'PostBlock', fields: [], relations: [] },
    ],
    tokens: [],
    storeEntries: [
      {
        name: 'sessionStore',
        state: { loading: { type: 'boolean' }, bootState: { type: 'string' }, me: { type: 'object' } },
        actions: ['login'],
      },
      {
        name: 'routeStore',
        state: { currentPath: { type: 'string' } },
        actions: ['navigate'],
      },
      {
        name: 'themeStore',
        state: { themes: { type: 'array' }, currentTheme: { type: 'string' } },
        actions: ['setThemes', 'setCurrentTheme'],
      },
    ],
    ...overrides,
  };
}

function ctx(overrides?: Partial<ContextData>): ValidationContext {
  return buildValidationContext(makeContext(overrides));
}

// ── Tests ──────────────────────────────────────────────────────────

describe('buildValidationContext', () => {
  it('builds component names from primitives and components', () => {
    const c = ctx();
    expect(c.componentNames.has('we-button')).toBe(true);
    expect(c.componentNames.has('we-text')).toBe(true);
    expect(c.componentNames.has('Column')).toBe(true);
    expect(c.componentNames.has('Row')).toBe(true);
    expect(c.componentNames.has('we-unknown')).toBe(false);
  });

  it('merges DS props per layer for primitives', () => {
    const c = ctx();
    // DesignSystemElement gets all layers
    const buttonProps = c.componentProps.get('we-button')!;
    expect(buttonProps.has('text')).toBe(true); // own prop
    expect(buttonProps.has('bg')).toBe(true); // visual DS prop
    expect(buttonProps.has('gap')).toBe(true); // flex DS prop
    expect(buttonProps.has('fontSize')).toBe(true); // typography DS prop

    // LayoutElement gets layout only
    const iconProps = c.componentProps.get('we-icon')!;
    expect(iconProps.has('name')).toBe(true); // own prop
    expect(iconProps.has('width')).toBe(true); // layout DS prop
    expect(iconProps.has('bg')).toBe(false); // visual — not on LayoutElement
    expect(iconProps.has('gap')).toBe(false); // flex — not on LayoutElement
  });

  it('builds store names and members', () => {
    const c = ctx();
    expect(c.storeNames.has('sessionStore')).toBe(true);
    expect(c.storeNames.has('routeStore')).toBe(true);
    expect(c.storeNames.has('unknownStore')).toBe(false);

    const adamMembers = c.storeMembers.get('sessionStore')!;
    expect(adamMembers.has('loading')).toBe(true);
    expect(adamMembers.has('login')).toBe(true);

    const routeMembers = c.storeMembers.get('routeStore')!;
    expect(routeMembers.has('navigate')).toBe(true);
  });

  it('builds model names', () => {
    const c = ctx();
    expect(c.modelNames.has('TaskBlock')).toBe(true);
    expect(c.modelNames.has('PostBlock')).toBe(true);
    expect(c.modelNames.has('Unknown')).toBe(false);
  });

  it('builds prop type map', () => {
    const c = ctx();
    const buttonTypes = c.componentPropTypes.get('we-button')!;
    expect(buttonTypes.get('disabled')).toBe('boolean');
    expect(buttonTypes.get('text')).toBe('string');
    // ButtonVariant is a named type → classified as 'string'
    expect(buttonTypes.get('variant')).toBe('string');
  });
});

describe('unknown component', () => {
  it('errors for unknown component type', () => {
    const result = validateSemantic({ type: 'we-buttn' }, ctx());
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].severity).toBe('error');
    expect(result.errors[0].message).toContain('Unknown component "we-buttn"');
  });

  it('suggests close matches', () => {
    const result = validateSemantic({ type: 'we-buttn' }, ctx());
    expect(result.errors[0].message).toContain('Did you mean "we-button"?');
  });

  it('no suggestion for distant names', () => {
    const result = validateSemantic({ type: 'completely-wrong' }, ctx());
    expect(result.errors[0].message).not.toContain('Did you mean');
  });

  it('passes for known primitive', () => {
    const result = validateSemantic({ type: 'we-button' }, ctx());
    const typeErrors = result.errors.filter((e) => e.path.endsWith('.type'));
    expect(typeErrors).toHaveLength(0);
  });

  it('passes for known component', () => {
    const result = validateSemantic({ type: 'Column' }, ctx());
    const typeErrors = result.errors.filter((e) => e.path.endsWith('.type'));
    expect(typeErrors).toHaveLength(0);
  });

  it('skips $if operator nodes', () => {
    const result = validateSemantic({ type: '$if', props: { condition: true, then: 'hi' } }, ctx());
    const typeErrors = result.errors.filter((e) => e.message.includes('Unknown component'));
    expect(typeErrors).toHaveLength(0);
  });

  it('skips $each operator nodes', () => {
    const result = validateSemantic({ type: '$each', props: { source: [], as: 'item' } }, ctx());
    const typeErrors = result.errors.filter((e) => e.message.includes('Unknown component'));
    expect(typeErrors).toHaveLength(0);
  });

  it('skips native HTML elements', () => {
    const result = validateSemantic({ type: 'div' }, ctx());
    expect(result.errors).toHaveLength(0);

    const result2 = validateSemantic({ type: 'span' }, ctx());
    expect(result2.errors).toHaveLength(0);

    const result3 = validateSemantic({ type: 'h1' }, ctx());
    expect(result3.errors).toHaveLength(0);
  });
});

describe('unknown prop', () => {
  it('warns for unknown prop on known component', () => {
    const result = validateSemantic({ type: 'we-button', props: { colour: 'red' } }, ctx());
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].severity).toBe('warning');
    expect(result.errors[0].message).toContain('Unknown prop "colour"');
  });

  it('passes for known own prop', () => {
    const result = validateSemantic({ type: 'we-button', props: { text: 'Click me' } }, ctx());
    expect(result.errors).toHaveLength(0);
  });

  it('passes for valid DS prop on DesignSystemElement', () => {
    const result = validateSemantic({ type: 'we-button', props: { bg: 'primary-500', gap: '300' } }, ctx());
    expect(result.errors).toHaveLength(0);
  });

  it('warns for DS prop from unsupported layer with helpful message', () => {
    // we-icon extends LayoutElement — only has layout layer
    const result = validateSemantic({ type: 'we-icon', props: { name: 'check', bg: 'red' } }, ctx());
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('"bg" requires the visual layer');
  });

  it('skips unknown components (already errored)', () => {
    const result = validateSemantic({ type: 'we-unknown', props: { anything: 'goes' } }, ctx());
    // Should have unknown component error, but NOT unknown prop warning
    const propErrors = result.errors.filter((e) => e.message.includes('Unknown prop'));
    expect(propErrors).toHaveLength(0);
  });

  it('styles prop is always valid', () => {
    const result = validateSemantic({ type: 'we-button', props: { styles: { color: 'red' } } }, ctx());
    const propErrors = result.errors.filter((e) => e.message.includes('Unknown prop'));
    expect(propErrors).toHaveLength(0);
  });

  it('event handlers are always valid', () => {
    const result = validateSemantic(
      { type: 'we-button', props: { onClick: { $action: 'routeStore.navigate' } } },
      ctx(),
    );
    const propErrors = result.errors.filter((e) => e.message.includes('Unknown prop'));
    expect(propErrors).toHaveLength(0);
  });
});

describe('prop type mismatch', () => {
  it('warns when boolean expected but string given', () => {
    const result = validateSemantic({ type: 'we-button', props: { disabled: 'yes' } }, ctx());
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].severity).toBe('warning');
    expect(result.errors[0].message).toContain('expects boolean, got string');
  });

  it('warns when string expected but number given', () => {
    const result = validateSemantic({ type: 'we-button', props: { text: 42 } }, ctx());
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].message).toContain('expects string, got number');
  });

  it('skips token objects', () => {
    const result = validateSemantic(
      { type: 'we-button', props: { disabled: { $store: 'sessionStore.loading' } } },
      ctx(),
    );
    const typeErrors = result.errors.filter((e) => e.message.includes('expects'));
    expect(typeErrors).toHaveLength(0);
  });

  it('passes for correct type', () => {
    const result = validateSemantic({ type: 'we-button', props: { disabled: true, text: 'hello' } }, ctx());
    expect(result.errors).toHaveLength(0);
  });
});

describe('unknown store', () => {
  it('errors for $store with unknown store name', () => {
    const result = validateSemantic({ type: 'we-button', props: { text: { $store: 'userStore.name' } } }, ctx());
    expect(result.errors.some((e) => e.severity === 'error' && e.message.includes('Unknown store "userStore"'))).toBe(
      true,
    );
  });

  it('passes for known store', () => {
    const result = validateSemantic({ type: 'we-button', props: { text: { $store: 'sessionStore.loading' } } }, ctx());
    const storeErrors = result.errors.filter((e) => e.message.includes('Unknown store'));
    expect(storeErrors).toHaveLength(0);
  });

  // Which modules exist is a property of the deployment's seed, not of this build, so `modules` is a
  // namespace with nothing to check members against. Without it a module's own fragments — the only
  // schemas that *have* to reference their store this way — failed on their first token and could not
  // be validated at all.
  it('accepts the modules namespace, whatever the module id', () => {
    const result = validateSemantic(
      {
        type: 'we-button',
        props: {
          text: { $store: 'modules.transcribe.pending' },
          onClick: { $action: 'modules.somethingNobodyHasWrittenYet.toggle' },
        },
      },
      ctx(),
    );
    expect(result.errors.filter((e) => e.message.includes('Unknown store'))).toHaveLength(0);
    expect(result.errors.filter((e) => e.message.includes('Unknown member'))).toHaveLength(0);
    expect(result.errors.filter((e) => e.message.includes('Unknown method'))).toHaveLength(0);
  });
});

describe('$slot outlet', () => {
  it('accepts a named anchor', () => {
    const result = validateSemantic({ type: '$slot', props: { anchor: 'call-controls' } }, ctx());
    expect(result.errors.filter((e) => e.path.includes('anchor'))).toHaveLength(0);
  });

  // The host resolves the marker before the renderer sees it, so a missing anchor renders nothing and
  // looks exactly like an anchor nobody contributed to. Nothing else would ever report it.
  it.each([
    ['no props at all', { type: '$slot' }],
    ['no anchor', { type: '$slot', props: {} }],
    ['an empty anchor', { type: '$slot', props: { anchor: '' } }],
    ['a non-string anchor', { type: '$slot', props: { anchor: 42 } }],
  ])('errors on %s', (_case, node) => {
    const result = validateSemantic(node, ctx());
    expect(result.errors.some((e) => e.severity === 'error' && e.message.includes('$slot'))).toBe(true);
  });

  it('is found nested inside other chrome, where a module actually puts it', () => {
    const result = validateSemantic(
      { type: 'Row', children: [{ type: 'we-button' }, { type: '$slot', props: {} }] },
      ctx(),
    );
    expect(result.errors.some((e) => e.message.includes('$slot'))).toBe(true);
  });
});

describe('unknown store member', () => {
  it('warns for unknown member path', () => {
    const result = validateSemantic(
      { type: 'we-button', props: { text: { $store: 'sessionStore.nonExistent' } } },
      ctx(),
    );
    expect(
      result.errors.some((e) => e.severity === 'warning' && e.message.includes('Unknown member "nonExistent"')),
    ).toBe(true);
  });

  it('passes for known member', () => {
    const result = validateSemantic({ type: 'we-button', props: { text: { $store: 'sessionStore.loading' } } }, ctx());
    const memberErrors = result.errors.filter((e) => e.message.includes('Unknown member'));
    expect(memberErrors).toHaveLength(0);
  });
});

describe('unknown action', () => {
  it('errors for $action with unknown store', () => {
    const result = validateSemantic({ type: 'we-button', props: { onClick: { $action: 'userStore.save' } } }, ctx());
    expect(result.errors.some((e) => e.severity === 'error' && e.message.includes('Unknown store "userStore"'))).toBe(
      true,
    );
  });

  it('warns for $action with unknown method on known store', () => {
    const result = validateSemantic({ type: 'we-button', props: { onClick: { $action: 'sessionStore.goTo' } } }, ctx());
    expect(result.errors.some((e) => e.severity === 'warning' && e.message.includes('Unknown method "goTo"'))).toBe(
      true,
    );
  });

  it('passes for known action', () => {
    const result = validateSemantic(
      { type: 'we-button', props: { onClick: { $action: 'routeStore.navigate' } } },
      ctx(),
    );
    const actionErrors = result.errors.filter((e) => e.message.includes('Unknown'));
    expect(actionErrors).toHaveLength(0);
  });
});

describe('$event/$arg inside $action args', () => {
  const nested = (args: unknown[]) =>
    validateSemantic(
      { type: 'we-button', props: { onClick: { $action: 'routeStore.navigate', args } } },
      ctx(),
    ).errors.filter((e) => e.severity === 'error' && e.message.includes('nested inside an operator'));

  it('errors when an event ref is wrapped in an operator', () => {
    // The bug this exists for: args resolve once at render time, so `$not` evaluates before any
    // event exists, against an unresolved `'$event.detail'` string — which is truthy. The argument
    // is a constant `false`, and a switch bound to it only ever sends one value. Nothing throws.
    expect(nested(['notes', { $not: '$event.detail' }])).toHaveLength(1);
  });

  it('errors however deeply the ref is buried', () => {
    expect(nested([{ $if: { condition: '$event.detail', then: 'a', else: 'b' } }])).toHaveLength(1);
    expect(nested([{ $concat: ['x', { $not: '$arg.value' }] }])).toHaveLength(1);
  });

  it('allows a bare event ref, which is the form that reaches call time', () => {
    expect(nested(['notes', '$event.detail'])).toHaveLength(0);
    expect(nested(['$arg'])).toHaveLength(0);
    expect(nested(['$arg.detail.value'])).toHaveLength(0);
  });

  it('leaves operators alone when no event ref is involved', () => {
    expect(nested([{ $not: { $store: 'sessionStore.me' } }])).toHaveLength(0);
  });
});

describe('unknown model', () => {
  it('errors for $query.model with unknown model name', () => {
    const result = validateSemantic({ type: 'we-button', props: { data: { $query: { entity: 'Taks' } } } }, ctx());
    expect(result.errors.some((e) => e.severity === 'error' && e.message.includes('Unknown model "Taks"'))).toBe(true);
  });

  it('suggests close model matches', () => {
    const result = validateSemantic({ type: 'we-button', props: { data: { $query: { entity: 'TasBlock' } } } }, ctx());
    expect(result.errors.some((e) => e.message.includes('Did you mean "TaskBlock"'))).toBe(true);
  });

  it('passes for known model', () => {
    const result = validateSemantic({ type: 'we-button', props: { data: { $query: { entity: 'TaskBlock' } } } }, ctx());
    const modelErrors = result.errors.filter((e) => e.message.includes('Unknown model'));
    expect(modelErrors).toHaveLength(0);
  });
});

describe('$local scope', () => {
  const meta = { name: 'T', description: '', icon: 'gear' };

  it('errors for $local with no $localState in scope', () => {
    const result = validateSemantic({ meta, type: 'we-button', props: { text: { $local: 'name' } } }, ctx());
    expect(
      result.errors.some((e) => e.severity === 'error' && e.message.includes('no $localState is declared in scope')),
    ).toBe(true);
  });

  it('stays silent for a fragment, whose scope belongs to whatever page composes it', () => {
    // `meta` is what makes a schema self-contained. A bare node is a piece of something else, and
    // `$localState` is scoped to the node declaring it — so a section reading state its host page
    // owns is correct, and judging it standalone reports an error about working code. The shell's
    // language settings section was flagged three times for reading a field the `/languages` route
    // declares. The check still runs in full against that route, where the answer is knowable.
    const result = validateSemantic({ type: 'we-button', props: { text: { $local: 'name' } } }, ctx());
    expect(result.errors.some((e) => e.message.includes('no $localState is declared in scope'))).toBe(false);
  });

  it('still catches an undeclared field in a fragment that declares some state', () => {
    // Only the "nothing in scope" case is unknowable standalone. Once a fragment declares its own
    // state, a reference outside it is wrong no matter what composes it.
    const result = validateSemantic(
      {
        type: 'Column',
        $localState: { name: { type: 'string', initial: '' } },
        children: [{ type: 'we-button', props: { text: { $local: 'other' } } }],
      },
      ctx(),
    );
    expect(result.errors.some((e) => e.severity === 'error' && e.message.includes('only declares'))).toBe(true);
  });

  it('errors for $local referencing undeclared field', () => {
    const result = validateSemantic(
      {
        type: 'Column',
        $localState: { name: { type: 'string', initial: '' } },
        children: [{ type: 'we-button', props: { text: { $local: 'nme' } } }],
      },
      ctx(),
    );
    expect(
      result.errors.some(
        (e) =>
          e.severity === 'error' && e.message.includes('$local references "nme" but $localState only declares: name'),
      ),
    ).toBe(true);
  });

  it('passes for declared field', () => {
    const result = validateSemantic(
      {
        type: 'Column',
        $localState: { name: { type: 'string', initial: '' } },
        children: [{ type: 'we-button', props: { text: { $local: 'name' } } }],
      },
      ctx(),
    );
    const localErrors = result.errors.filter((e) => e.message.includes('$local'));
    expect(localErrors).toHaveLength(0);
  });

  it('works with nested $localState (merged scope)', () => {
    const result = validateSemantic(
      {
        type: 'Column',
        $localState: { name: { type: 'string', initial: '' } },
        children: [
          {
            type: 'Column',
            $localState: { email: { type: 'string', initial: '' } },
            children: [
              { type: 'we-button', props: { text: { $local: 'name' } } },
              { type: 'we-button', props: { text: { $local: 'email' } } },
            ],
          },
        ],
      },
      ctx(),
    );
    const localErrors = result.errors.filter((e) => e.message.includes('$local') || e.message.includes('$localState'));
    expect(localErrors).toHaveLength(0);
  });

  it('checks $error token against scope', () => {
    const result = validateSemantic(
      {
        type: 'Column',
        $localState: { name: { type: 'string', initial: '' } },
        children: [{ type: 'we-text', props: { tag: { $error: 'nme' } } }],
      },
      ctx(),
    );
    expect(result.errors.some((e) => e.severity === 'error' && e.message.includes('$error references "nme"'))).toBe(
      true,
    );
  });

  it('checks $setLocal token against scope', () => {
    const result = validateSemantic(
      {
        type: 'Column',
        $localState: { name: { type: 'string', initial: '' } },
        children: [{ type: 'we-button', props: { onClick: { $setLocal: 'typo', from: '$event.detail' } } }],
      },
      ctx(),
    );
    expect(result.errors.some((e) => e.severity === 'error' && e.message.includes('$setLocal references "typo"'))).toBe(
      true,
    );
  });

  it('skips $touch: "$all"', () => {
    const result = validateSemantic(
      {
        type: 'Column',
        $localState: { name: { type: 'string', initial: '' } },
        children: [{ type: 'we-button', props: { onClick: { $touch: '$all' } } }],
      },
      ctx(),
    );
    const touchErrors = result.errors.filter((e) => e.message.includes('$touch'));
    expect(touchErrors).toHaveLength(0);
  });

  it('skips $formValid: "$scope"', () => {
    const result = validateSemantic(
      {
        type: 'Column',
        $localState: { name: { type: 'string', initial: '' } },
        children: [{ type: 'we-button', props: { disabled: { $formValid: '$scope' } } }],
      },
      ctx(),
    );
    const formErrors = result.errors.filter((e) => e.message.includes('$formValid'));
    expect(formErrors).toHaveLength(0);
  });
});

describe('route validation', () => {
  it('warns for duplicate route paths', () => {
    const result = validateSemantic(
      {
        type: 'Column',
        routes: [
          { type: 'div', path: '/home' },
          { type: 'div', path: '/settings' },
          { type: 'div', path: '/settings' },
        ],
        children: [{ type: '$routes' }],
      },
      ctx(),
    );
    expect(
      result.errors.some((e) => e.severity === 'warning' && e.message.includes('Duplicate route path "/settings"')),
    ).toBe(true);
  });

  it('warns for routes without $routes outlet', () => {
    const result = validateSemantic(
      {
        type: 'Column',
        routes: [{ type: 'div', path: '/home' }],
        children: [{ type: 'we-text' }],
      },
      ctx(),
    );
    expect(
      result.errors.some((e) => e.severity === 'warning' && e.message.includes('no { type: "$routes" } in children')),
    ).toBe(true);
  });

  it('warns for orphaned $routes', () => {
    const result = validateSemantic(
      {
        type: 'Column',
        children: [{ type: '$routes' }],
      },
      ctx(),
    );
    expect(
      result.errors.some((e) => e.severity === 'warning' && e.message.includes('no "routes" array on any ancestor')),
    ).toBe(true);
  });

  it('passes when routes and $routes outlet match', () => {
    const result = validateSemantic(
      {
        type: 'Column',
        routes: [
          { type: 'div', path: '/home' },
          { type: 'div', path: '/settings' },
        ],
        children: [{ type: '$routes' }],
      },
      ctx(),
    );
    const routeErrors = result.errors.filter((e) => e.message.includes('routes') || e.message.includes('$routes'));
    expect(routeErrors).toHaveLength(0);
  });

  it('errors when routes array is on a non-root child node', () => {
    // The AI mistake: routes defined on an inner Column child instead of the root.
    // The router never reads routes from arbitrary children — they are dead code.
    const result = validateSemantic(
      {
        type: 'Column',
        children: [
          {
            type: 'Column',
            routes: [{ type: 'div', path: '/posts' }],
            children: [{ type: '$routes' }],
          },
        ],
      },
      ctx(),
    );
    expect(
      result.errors.some(
        (e) =>
          e.severity === 'error' &&
          e.message.includes('non-root, non-route child node') &&
          e.message.includes('routes'),
      ),
    ).toBe(true);
  });

  it('errors when a route entry uses type "$routes"', () => {
    // The AI mistake: { "path": "/posts", "type": "$routes" } renders null as a leaf route.
    const result = validateSemantic(
      {
        type: 'Column',
        routes: [
          { type: '$routes', path: '/posts' },
          { type: 'div', path: '/home' },
        ],
        children: [{ type: '$routes' }],
      },
      ctx(),
    );
    expect(
      result.errors.some(
        (e) =>
          e.severity === 'error' && e.message.includes('renders null as a leaf route') && e.message.includes('/posts'),
      ),
    ).toBe(true);
  });

  it('passes for nested routes on a route entry', () => {
    // A route entry itself (not a plain child) is allowed to have its own routes array.
    const result = validateSemantic(
      {
        type: 'Column',
        routes: [
          {
            type: 'Row',
            path: '/space',
            routes: [
              { type: 'div', path: '/' },
              { type: 'div', path: '/posts' },
            ],
            children: [{ type: '$routes' }],
          },
        ],
        children: [{ type: '$routes' }],
      },
      ctx(),
    );
    const routeErrors = result.errors.filter(
      (e) => e.message.includes('non-root') || e.message.includes('renders null'),
    );
    expect(routeErrors).toHaveLength(0);
  });
});

describe('nested detection', () => {
  it('finds tokens inside $if.condition', () => {
    const result = validateSemantic(
      {
        type: 'we-button',
        props: {
          disabled: {
            $if: {
              condition: { $store: 'unknownStore.value' },
              then: true,
              else: false,
            },
          },
        },
      },
      ctx(),
    );
    expect(result.errors.some((e) => e.message.includes('Unknown store "unknownStore"'))).toBe(true);
  });

  it('finds tokens inside $concat items', () => {
    const result = validateSemantic(
      {
        type: 'we-text',
        props: {
          tag: { $concat: ['Hello ', { $store: 'badStore.name' }] },
        },
      },
      ctx(),
    );
    expect(result.errors.some((e) => e.message.includes('Unknown store "badStore"'))).toBe(true);
  });

  it('finds tokens inside $eq comparisons', () => {
    const result = validateSemantic(
      {
        type: 'we-button',
        props: {
          disabled: { $eq: [{ $store: 'sessionStore.loading' }, { $store: 'fakeStore.val' }] },
        },
      },
      ctx(),
    );
    expect(result.errors.some((e) => e.message.includes('Unknown store "fakeStore"'))).toBe(true);
  });
});

describe('deep tree', () => {
  it('validates children recursively', () => {
    const result = validateSemantic(
      {
        type: 'Column',
        children: [
          {
            type: 'Row',
            children: [{ type: 'we-buttn' }],
          },
        ],
      },
      ctx(),
    );
    expect(result.errors.some((e) => e.message.includes('Unknown component "we-buttn"'))).toBe(true);
  });

  it('validates slots', () => {
    const result = validateSemantic(
      {
        type: 'we-button',
        slots: {
          icon: { type: 'we-icn', props: { name: 'check' } },
        },
      },
      ctx(),
    );
    expect(result.errors.some((e) => e.message.includes('Unknown component "we-icn"'))).toBe(true);
  });
});

describe('$each validation', () => {
  it('$each without as prop is valid (defaults to "item")', () => {
    const result = validateSemantic({ type: '$each', props: { source: [] } }, ctx());
    const eachErrors = result.errors.filter((e) => e.message.includes('$each'));
    expect(eachErrors).toHaveLength(0);
  });

  it('$each with explicit as prop is valid', () => {
    const result = validateSemantic({ type: '$each', props: { source: [], as: 'item' } }, ctx());
    const eachErrors = result.errors.filter((e) => e.message.includes('$each'));
    expect(eachErrors).toHaveLength(0);
  });
});

describe('composed validation', () => {
  it('validateSchema skips semantic on structural failure', () => {
    // Invalid meta type — structural failure for template schema
    const result = validateSchema({ type: 'root', meta: { name: 123 } }, ctx());
    expect(result.valid).toBe(false);
    // Should have structural errors only
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('returns combined errors when structural passes', () => {
    const result = validateSchema(
      {
        type: 'we-buttn',
        meta: { name: 'Test', description: 'test', icon: 'test' },
      },
      ctx(),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('Unknown component'))).toBe(true);
  });
});

describe('severity', () => {
  it('errors make result invalid', () => {
    const result = validateSemantic({ type: 'we-buttn' }, ctx());
    expect(result.valid).toBe(false);
  });

  it('warnings keep result valid', () => {
    const result = validateSemantic({ type: 'we-button', props: { unknownProp: 'value' } }, ctx());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].severity).toBe('warning');
  });
});

describe('$if branch slots', () => {
  // The renderer hands `then`/`else` straight to renderNode, so only a node renders. Both
  // spellings of a conditional look interchangeable — `{ $if: … }` is the prop-level operator,
  // `{ type: '$if', props: … }` is the node — and the wrong one in a branch slot renders nothing
  // at all, silently and only at runtime. It shipped in WE's boot screen and blanked the sign-in
  // form with every check passing.

  it('rejects an operator token where a node belongs', () => {
    const schema = {
      type: '$if',
      props: {
        condition: true,
        then: { type: 'we-text', children: ['yes'] },
        else: { $if: { condition: true, then: { type: 'we-text', children: ['no'] } } },
      },
    };
    const result = validateSemantic(schema, ctx());
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('Operator token "$if" used where a schema node is required');
    expect(result.errors[0].path).toBe('.props.else');
  });

  it('accepts a properly nested $if node', () => {
    const schema = {
      type: '$if',
      props: {
        condition: true,
        then: { type: 'we-text', children: ['yes'] },
        else: {
          type: '$if',
          props: { condition: false, then: { type: 'we-text', children: ['no'] } },
        },
      },
    };
    expect(validateSemantic(schema, ctx()).valid).toBe(true);
  });

  it('accepts a node that merely carries $localState alongside its type', () => {
    // "Has a $-prefixed key" does not make something a token: $localState and $queries are
    // siblings of `type`. Treating them as tokens skipped the whole subtree beneath them.
    const schema = {
      type: '$if',
      props: {
        condition: true,
        then: {
          type: 'Column',
          $localState: { open: { type: 'boolean', initial: false } },
          children: [{ type: 'we-text', children: ['hi'] }],
        },
      },
    };
    expect(validateSemantic(schema, ctx()).valid).toBe(true);
  });

  it('still reports errors inside a branch subtree', () => {
    // The point of walking it: a typo under a $localState-carrying branch used to be invisible.
    const schema = {
      type: '$if',
      props: {
        condition: true,
        then: {
          type: 'Column',
          $localState: { open: { type: 'boolean', initial: false } },
          children: [{ type: 'we-nonexistent' }],
        },
      },
    };
    const result = validateSemantic(schema, ctx());
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('Unknown component "we-nonexistent"'))).toBe(true);
  });
});

describe('$local dot paths', () => {
  it('accepts a read into an object-typed field', () => {
    // Documented: `{ $local: 'name.nested.path' }` reads into an object-typed local. Only the
    // root segment is a declaration.
    const schema = {
      type: 'Column',
      $localState: { location: { type: 'object', initial: null } },
      children: [{ type: 'we-text', props: { text: { $local: 'location.city' } } }],
    };
    expect(validateSemantic(schema, ctx()).valid).toBe(true);
  });

  it('still rejects an undeclared root', () => {
    const schema = {
      type: 'Column',
      $localState: { location: { type: 'object', initial: null } },
      children: [{ type: 'we-text', props: { text: { $local: 'somewhereElse.city' } } }],
    };
    expect(validateSemantic(schema, ctx()).valid).toBe(false);
  });
});
