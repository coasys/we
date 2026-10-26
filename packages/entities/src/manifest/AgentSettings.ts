import type { CoreEntityDef } from './defs';

export const AgentSettings: CoreEntityDef = {
  base: 'Ad4mModel',
  methodRelations: ['installedTemplates', 'installedThemes', 'spaceTemplatePreferences'],
  typedArrays: ['installedTemplates', 'installedThemes', 'spaceTemplatePreferences'],
  entity: {
    flag: { predicate: 'we://flag', value: 'we://root' },
    properties: {
      currentTemplateId: { type: 'string', predicate: 'we://current_template', default: 'default' },
      defaultTemplateId: { type: 'string', predicate: 'we://default_template', default: 'default' },
      /**
       * Which app this agent is in — the template WE's own chrome is drawn from: the sidebar, the
       * rail, and whatever an app of their own arranges around every space.
       *
       * Empty means the deployment's app (the seed's `app`, else WE's own). Not per space: which app
       * you are in is a fact about you, not about the community on screen. Only WE's app or one of the
       * agent's own copies is honoured, since an app is drawn with the chrome tier.
       */
      appTemplateId: { type: 'string', predicate: 'we://app_template', default: '' },
      /**
       * The bundles this agent installed, and what each wrote: JSON, a list of `InstalledBundle`
       * (`app-shell/src/shared/bundles/installedBundles.ts`).
       *
       * Kept so an app can be recognised when a later version of it is installed, removed with
       * everything it brought, and asked how it shows spaces — its display policy is read from here,
       * so leaving the app is all it takes to stop it. A seed's bundles are built in and never here.
       */
      installedBundles: { type: 'string', predicate: 'we://installed_bundles', default: '' },
      currentThemeId: { type: 'string', predicate: 'we://current_theme', default: 'default' },
      defaultThemeId: { type: 'string', predicate: 'we://default_theme', default: 'default' },
      /**
       * Which two themes "Follow system" chooses between.
       *
       * `system` is not a theme, it is a question, and until now it was a question with only two
       * possible answers: the built-in `light` and the built-in `dark`. So an agent who had built
       * their own pair could follow the OS or wear their own themes, never both — and the setting
       * that looked like it meant "match my machine" quietly meant "match my machine using somebody
       * else's palette".
       *
       * Empty means the built-in of that polarity, which is what every existing agent gets and what
       * the feature already did. Stored as ids rather than as a resolved theme, because the point of
       * following is that the answer is given at the moment of use.
       */
      systemLightThemeId: { type: 'string', predicate: 'we://system_light_theme', default: '' },
      systemDarkThemeId: { type: 'string', predicate: 'we://system_dark_theme', default: '' },
      /**
       * The person's display needs, as JSON (`DisplayPreferences` in @we/themes): colour scheme,
       * contrast, text size, density and motion. Applied over every theme on screen — a space's
       * included — because they are this person's needs, not a matter of taste a theme may overrule.
       * Empty means follow the system on every axis it has a signal for, and change nothing else.
       *
       * The colour scheme replaces `themeMode`, which held that one axis alone.
       */
      displayPreferences: { type: 'string', predicate: 'we://display_preferences', default: '' },
      claudeApiKey: { type: 'string', predicate: 'we://claude_api_key', default: '' },
      datasetOrder: { type: 'string', predicate: 'we://dataset_order', default: '' },
      globalSpaceJoined: { type: 'boolean', predicate: 'we://global_space_joined', default: false },
      globalSpaceUrl: { type: 'string', predicate: 'we://global_space_url', default: '' },
      useSpaceTemplate: { type: 'boolean', predicate: 'we://use_space_template', default: true },
      /**
       * Whether a template may bring its own theme.
       *
       * The sibling of `useSpaceTemplate`, and the same species of question: may something other than me
       * choose part of how this looks. A template can name a theme it was designed for
       * (`TemplateMeta.themeId`), which is honoured as a rung in the theme chain rather than written
       * anywhere — so this flag is one condition in the resolver, not a setting to unwind.
       *
       * Defaults on, because a showcase template that renders in the wrong palette is a worse first
       * impression than one that moves a theme somebody had not thought about. Anyone who has
       * deliberately settled on a look turns it off once, or pins a theme per space, and template
       * switching stops touching it.
       */
      useTemplateTheme: { type: 'boolean', predicate: 'we://use_template_theme', default: true },
      /**
       * Whether a template somebody else changes is updated on screen as they save it, or waits for
       * this agent to say so.
       *
       * Defaults off: the page changing under somebody mid-task is the surprise worth sparing them,
       * and a notice with "Update now" costs one press. This agent's own changes, made on another
       * device or asked of an agent, always apply, and so does anything they are editing — a stale
       * copy there is one save away from overwriting the newer one.
       */
      followTemplateUpdates: { type: 'boolean', predicate: 'we://follow_template_updates', default: false },
      /**
       * Whether a space's theme covers the whole window, or only the space's own content.
       *
       * `'global'` themes everything including the shell — the sidebar, settings, your profile.
       * Anything else, including unset, means scoped: the shell keeps your own theme and the space
       * decorates its content.
       *
       * Scoped is the default because the two failure modes are not symmetric. A dark or low-contrast
       * community theme taking over the whole window makes the settings page hard to read — and that is
       * the page you would go to to undo it. The cost of the other default is that a space feels less
       * immersive, which is recoverable from a shell that still reads normally. So immersion is the
       * thing you opt into.
       *
       * Read as "not `'global'`" rather than compared against `'scoped'`, so an agent whose record
       * predates this field gets the safe answer rather than an empty string.
       */
      themeScope: { type: 'string', predicate: 'we://theme_scope', default: '' },
      /**
       * Which feature modules this agent wants available to them, anywhere, as a JSON array of ids.
       *
       * The middle of three layers. The deployment's seed says what is shipped; this says what I want
       * from it; `Space.enabledModules` says what a community runs. A module renders only where all
       * three agree — so turning one off here mutes it for me in every space, without touching what
       * anyone else sees.
       *
       * **Empty means "not decided", not "none"** — the same rule as `Space.enabledModules`, and for the
       * same reason: an agent who has never opened the setting must keep everything they had.
       *
       * Mine, so it lives in the root dataset rather than in any space. Writing it into a shared space
       * would broadcast which modules I have turned off to every other member.
       */
      installedModules: { type: 'string', predicate: 'we://installed_modules', default: '' },
      /**
       * What this agent decides about each capability's settings, as JSON.
       *
       * `{ "<group>": { "<key>": value } }`, where a group is a module id or a capability the host
       * declares. One field rather than one per setting: `autoInterpret` and `extractionTargets` are
       * here as bespoke columns already, and every capability that wanted an opinion added another — a core entity accreting a field on behalf of a module is
       * the shape this replaces.
       *
       * **Absent means "no opinion"**, never "off" — the same rule as `enabledModules`. A level says
       * nothing until somebody sets something, and the resolver takes the most specific level that
       * has an opinion. See `moduleSettings.ts` in the app shell for the order and for how a
       * `restrict` setting differs.
       */
      moduleSettings: { type: 'string', predicate: 'we://module_settings', default: '' },
    },
    relations: {
      installedTemplates: { target: 'Template', cardinality: 'many', predicate: 'we://installed_template' },
      installedThemes: { target: 'Theme', cardinality: 'many', predicate: 'we://installed_theme' },
      spaceTemplatePreferences: {
        target: 'SpaceTemplatePreference',
        cardinality: 'many',
        predicate: 'we://space_template_preference',
      },
    },
  },
};
