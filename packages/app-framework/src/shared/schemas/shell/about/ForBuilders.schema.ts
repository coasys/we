import type { TemplateSchema } from '@we/schema-shared';

function heading(text: string) {
  return {
    type: 'we-text',
    props: { fontSize: '700', fontWeight: 'bold', color: 'neutral-900', lineHeight: '1.3' },
    children: [text],
  };
}

function subheading(text: string) {
  return {
    type: 'we-text',
    props: { fontSize: '600', fontWeight: 'semibold', color: 'neutral-900' },
    children: [text],
  };
}

function body(text: string) {
  return {
    type: 'we-text',
    props: { fontSize: '500', color: 'neutral-700', lineHeight: '1.7' },
    children: [text],
  };
}

export const forBuildersTemplate: TemplateSchema = {
  meta: { name: 'For Builders', description: 'How WE serves builders', icon: 'hammer' },
  type: 'Column',
  props: { width: '100%', minHeight: '100%', bg: 'neutral-50', ax: 'center' },
  children: [
    {
      type: 'Column',
      props: { px: '500', py: '800', gap: '700', maxWidth: '800px', width: '100%' },
      children: [
        // ── Back nav ──────────────────────────────────────────────────────
        {
          type: 'Row',
          props: { ay: 'center', gap: '200' },
          children: [
            {
              type: 'we-button',
              props: {
                text: 'Back',
                variant: 'ghost',
                size: 'sm',
                iconLeft: 'arrow-left',
                onClick: { $action: 'templateStore.openShellView', args: ['landing-page'] },
              },
            },
          ],
        },

        // ── Heading ───────────────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            heading('Stop rebuilding the 80%. Start only building what is actually yours.'),
            body(
              'The features that make your project genuinely novel — a unique way to surface signals, a different model for resource coordination, a new kind of community interface — represent maybe 20% of what you need to build. The other 80% is infrastructure almost every social tool needs: identity, profiles, posts, threads, feeds, roles, notifications, moderation, content composition, data storage.',
            ),
            body(
              "That 80% gets rebuilt from scratch, in isolation, by every team in the space. The result is a graveyard of incompatible systems, duplicated effort, and experiences that can't interoperate even when they're solving adjacent problems.",
            ),
            body('WE is designed to change that.'),
          ],
        },

        // ── Shared infrastructure ─────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            heading('Shared infrastructure, not shared constraints'),
            body(
              'WE provides the 80% as shared, open infrastructure. Every community using WE gets identity, data continuity, a content composition system, a design system, and a component ecosystem — built in, available, and consistent.',
            ),
            body(
              "That means when you build for WE, you're building the 20%: the novel interface, the unique signalling logic, the coordination pattern that makes your project genuinely interesting.",
            ),
            body(
              "You publish it as a template, a widget, or a block type. Others can adopt it, fork it, improve it, and publish improvements back. The whole ecosystem gets smarter from work you've already done.",
            ),
            body(
              "This isn't just a developer convenience. It's a structural shift in how social tool innovation works — from isolated products competing through lock-in, to a compounding commons where good ideas spread.",
            ),
          ],
        },

        // ── What you can build ────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '500' },
          children: [
            heading('What you can build'),

            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                subheading('Templates'),
                body(
                  'A template is a complete community environment defined as a JSON schema — which components to include, how they are laid out, how they are styled, what interactions are possible. Templates can be forked, remixed, and AI-generated.',
                ),
                body(
                  'A community adopts your template, customises it to fit their context, and publishes their fork. The pattern evolves through real use rather than remaining frozen inside one product.',
                ),
              ],
            },

            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                subheading('Widgets and components'),
                body(
                  'Reusable UI building blocks contributed to the shared ecosystem. Build once — available to every community and experience that wants them.',
                ),
              ],
            },

            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                subheading('Block types'),
                body(
                  "WE's block system is the shared vocabulary for content: the standard building blocks every experience can read and render. New block types can be contributed to extend what every community can compose and express — not just in your experience, but across the whole ecosystem.",
                ),
              ],
            },

            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                subheading('Signalling systems'),
                body(
                  'Communities can define custom signal types — what counts as relevant, urgent, high quality, or worth amplifying in their context. Build reusable signalling patterns other communities can adopt and adapt.',
                ),
              ],
            },

            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                subheading('Experiences'),
                body(
                  'Full environments — complete UIs and coordination stacks — that communities can install and run. Think less "app" and more "lens over shared data." Two music experiences are not fighting for lock-in; they are both views over the same library. Users can run both, and their data is never trapped.',
                ),
              ],
            },
          ],
        },

        // ── Schema approach ───────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '400', p: '600', r: 'lg', bg: 'neutral-100', border: '1px solid var(--we-color-neutral-200)' },
          children: [
            heading('Why the schema approach matters'),
            body(
              'Experiences in WE are defined as JSON schemas — not compiled, sealed code. This is a deliberate architectural choice with several significant consequences.',
            ),
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                subheading('Inspectable and auditable'),
                body(
                  "Anyone can read a template and understand what it does before installing it. No hidden behaviours. That's a trust primitive most platforms don't have.",
                ),
              ],
            },
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                subheading('AI-native by design'),
                body(
                  "Structured schemas are something language models can read, reason about, and generate reliably. WE isn't bolting AI onto a legacy system — it's designed from the ground up so AI can actively work inside the environment. AI already works today to generate templates from natural language descriptions, including reasoning about data structures from perspectives created entirely outside WE.",
                ),
              ],
            },
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                subheading('Framework agnostic'),
                body(
                  'The schema system does not tie you or the ecosystem to any single frontend framework. Solid is the current default renderer, but the architecture is open. Build on a specification, not a proprietary runtime.',
                ),
              ],
            },
            {
              type: 'Column',
              props: { gap: '200' },
              children: [
                subheading('Safe to share'),
                body(
                  'Declarative schemas can be shared, versioned, and forked without the risks of executing arbitrary code. The composability model is safe by design.',
                ),
              ],
            },
          ],
        },

        // ── Interoperability ──────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            heading('The interoperability advantage'),
            body(
              'WE sits on AD4M, which means WE experiences can read and render data from perspectives created by entirely independent tools — not just other WE experiences. A community might be using Flux for their social layer; a WE experience can understand and surface that data without any coordination between the teams that built each tool.',
            ),
            body(
              "That's a fundamentally different model from platform interoperability agreements. Shared semantics at the protocol level means communities aren't trapped by whatever integrations a platform has chosen to build.",
            ),
          ],
        },

        // ── Network effects ───────────────────────────────────────────────
        {
          type: 'Column',
          props: { gap: '300' },
          children: [
            heading('Two-sided network effects'),
            body(
              'As more builders contribute templates and components, the environment becomes richer for communities. As more communities use WE, there are more real-world contexts in which your work gets tested, improved, and forked. Each side strengthens the other.',
            ),
            body(
              "That's a healthier model for building in this space than trying to permanently capture a community inside your product.",
            ),
          ],
        },

        // ── Nav buttons ───────────────────────────────────────────────────
        {
          type: 'Row',
          props: { gap: '300', wrap: true },
          children: [
            {
              type: 'we-button',
              props: {
                text: 'Back to overview',
                variant: 'secondary',
                onClick: { $action: 'templateStore.openShellView', args: ['landing-page'] },
              },
            },
            {
              type: 'we-button',
              props: {
                text: 'How it works →',
                variant: 'ghost',
                onClick: { $action: 'templateStore.openShellView', args: ['how-it-works'] },
              },
            },
          ],
        },
      ],
    },
  ],
};
