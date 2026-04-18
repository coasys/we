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
        name: 'adamStore',
        state: { loading: { type: 'boolean' }, bootState: { type: 'string' }, me: { type: 'object' } },
        actions: ['navigate', 'login'],
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
    expect(c.storeNames.has('adamStore')).toBe(true);
    expect(c.storeNames.has('routeStore')).toBe(true);
    expect(c.storeNames.has('unknownStore')).toBe(false);

    const adamMembers = c.storeMembers.get('adamStore')!;
    expect(adamMembers.has('loading')).toBe(true);
    expect(adamMembers.has('navigate')).toBe(true);
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
      { type: 'we-button', props: { onClick: { $action: 'adamStore.navigate' } } },
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
    const result = validateSemantic({ type: 'we-button', props: { disabled: { $store: 'adamStore.loading' } } }, ctx());
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
    const result = validateSemantic({ type: 'we-button', props: { text: { $store: 'adamStore.loading' } } }, ctx());
    const storeErrors = result.errors.filter((e) => e.message.includes('Unknown store'));
    expect(storeErrors).toHaveLength(0);
  });
});

describe('unknown store member', () => {
  it('warns for unknown member path', () => {
    const result = validateSemantic({ type: 'we-button', props: { text: { $store: 'adamStore.nonExistent' } } }, ctx());
    expect(
      result.errors.some((e) => e.severity === 'warning' && e.message.includes('Unknown member "nonExistent"')),
    ).toBe(true);
  });

  it('passes for known member', () => {
    const result = validateSemantic({ type: 'we-button', props: { text: { $store: 'adamStore.loading' } } }, ctx());
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
    const result = validateSemantic({ type: 'we-button', props: { onClick: { $action: 'adamStore.goTo' } } }, ctx());
    expect(result.errors.some((e) => e.severity === 'warning' && e.message.includes('Unknown method "goTo"'))).toBe(
      true,
    );
  });

  it('passes for known action', () => {
    const result = validateSemantic(
      { type: 'we-button', props: { onClick: { $action: 'adamStore.navigate' } } },
      ctx(),
    );
    const actionErrors = result.errors.filter((e) => e.message.includes('Unknown'));
    expect(actionErrors).toHaveLength(0);
  });
});

describe('unknown model', () => {
  it('errors for $query.model with unknown model name', () => {
    const result = validateSemantic({ type: 'we-button', props: { data: { $query: { model: 'Taks' } } } }, ctx());
    expect(result.errors.some((e) => e.severity === 'error' && e.message.includes('Unknown model "Taks"'))).toBe(true);
  });

  it('suggests close model matches', () => {
    const result = validateSemantic({ type: 'we-button', props: { data: { $query: { model: 'TasBlock' } } } }, ctx());
    expect(result.errors.some((e) => e.message.includes('Did you mean "TaskBlock"'))).toBe(true);
  });

  it('passes for known model', () => {
    const result = validateSemantic({ type: 'we-button', props: { data: { $query: { model: 'TaskBlock' } } } }, ctx());
    const modelErrors = result.errors.filter((e) => e.message.includes('Unknown model'));
    expect(modelErrors).toHaveLength(0);
  });
});

describe('$local scope', () => {
  it('errors for $local with no $localState in scope', () => {
    const result = validateSemantic({ type: 'we-button', props: { text: { $local: 'name' } } }, ctx());
    expect(
      result.errors.some((e) => e.severity === 'error' && e.message.includes('no $localState is declared in scope')),
    ).toBe(true);
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
          disabled: { $eq: [{ $store: 'adamStore.loading' }, { $store: 'fakeStore.val' }] },
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
