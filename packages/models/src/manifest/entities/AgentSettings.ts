import type { CoreEntityDef } from '../defs';

export const AgentSettings: CoreEntityDef = {
  base: 'Ad4mModel',
  methodRelations: ["installedTemplates", "installedThemes", "spaceTemplatePreferences"],
  entity: {
    flag: {"predicate": "we://flag", "value": "we://root"},
    properties: {
      currentTemplateId: { type: "string", predicate: "we://current_template", default: "default" },
      defaultTemplateId: { type: "string", predicate: "we://default_template", default: "default" },
      currentThemeId: { type: "string", predicate: "we://current_theme", default: "default" },
      defaultThemeId: { type: "string", predicate: "we://default_theme", default: "default" },
      claudeApiKey: { type: "string", predicate: "we://claude_api_key", default: "" },
      datasetOrder: { type: "string", predicate: "we://dataset_order", default: "" },
      globalSpaceJoined: { type: "boolean", predicate: "we://global_space_joined", default: false },
      globalSpaceUrl: { type: "string", predicate: "we://global_space_url", default: "" },
      useSpaceTemplate: { type: "boolean", predicate: "we://use_space_template", default: true },
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
      useTemplateTheme: { type: "boolean", predicate: "we://use_template_theme", default: true },
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
      themeScope: { type: "string", predicate: "we://theme_scope", default: "" },
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
      installedModules: { type: "string", predicate: "we://installed_modules", default: "" },
    },
    relations: {
      installedTemplates: { target: "Template", cardinality: "many", predicate: "we://installed_template" },
      installedThemes: { target: "Theme", cardinality: "many", predicate: "we://installed_theme" },
      spaceTemplatePreferences: { target: "SpaceTemplatePreference", cardinality: "many", predicate: "we://space_template_preference" },
    },
  },
};
