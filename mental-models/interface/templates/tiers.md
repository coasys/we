# Template tiers

A **template tier** is a list of **capability groups** that a template gets. The host builds a **template bag** from the stores with only the members of those groups, and the template renders against that bag. A space template gets `SPACE_TIER`. Host chrome (the app template, its pages, the boot screen, settings) gets `CHROME_TIER`.

**Why:** A group is the unit that a person can read at install time, such as "Install, publish and remove templates and themes on your account". So `templateSurface.ts` classifies each store member into one group, in one file that can be reviewed. A member outside the tier is absent from the bag, not blocked: it resolves to `undefined`, as any unknown path does. `templateSurface.test.ts` fails when a store member has no classification.

**Parent:** [Templates](README.md)

<details><summary>How it works</summary>

| Tier | Groups |
|---|---|
| `SPACE_TIER` | `content`, `navigation`, `view-state`, `signals`, `presence`, `identity`, `space-settings`, `appearance` |
| `CHROME_TIER` | `SPACE_TIER` plus `host-layout`, `space-admin`, `library`, `agent`, `session`, `runtime-admin`, `editor`, `clipboard`, `keys`, `devices` |

1. `TEMPLATE_SURFACE` classifies each member of each store. A `state` member (read in expressions) or an action (called with `$invoke`) is in one group. An action can be `destructive` or `ambient`. A wiring member is in no template bag at any tier.
2. `buildTemplateBag(stores, { grants, gesture, onDestructive })` copies the granted members. It tags only `state` members with `markReactive`, so an expression that walks a path calls only state accessors.
3. An action that is not `ambient` runs only during a person's gesture ([Handler tokens](../schema/handlers.md)). The host asks for a confirmation (`onDestructive`) before a `destructive` action runs.
4. `space-settings` actions apply to the space on screen. `appearance` chooses among the templates and themes that the agent already has.
5. `TemplateProvider` provides two bags: `chromeBag` (`CHROME_TIER`) for the app template and shell overlays, and `templateBag` for the space template.

**Acceptance.** `acceptTemplate(decoded, { grants })` runs on each template that the host loads:
- A template that fails `validateStructure` is refused, so it is not added to the list ([Validation](../schema/validation.md)).
- A reference outside the tier, or an HTML element that a template may not mount, is admitted and reported. `inspectTemplateSurface` finds these references.
- `describeCapabilities`, `describeAcceptance` and `describeRefusal` give the text for an install screen or a log.

</details>

<details><summary>Where in the code</summary>

- [templateSurface.ts](../../../packages/app-shell/src/shared/registries/templateSurface.ts): `CAPABILITY_GROUPS`, `SPACE_TIER`, `CHROME_TIER`, `TEMPLATE_SURFACE`, `buildTemplateBag`, `inspectTemplateSurface`.
- [templateBag.ts](../../../packages/app-shell/src/shared/registries/templateBag.ts): `provideTemplateBag`, `templateBag`, `provideChromeBag`, `chromeBag`.
- [templateAcceptance.ts](../../../packages/app-shell/src/shared/templateAcceptance.ts): `acceptTemplate`, `describeCapabilities`, `describeAcceptance`, `describeRefusal`.
- [TemplateProvider.tsx](../../../packages/app-shell/src/frameworks/solid/providers/TemplateProvider.tsx): where the bags are built.
- [templateSurface.test.ts](../../../packages/app-shell/tests/templateSurface.test.ts).
- [docs/architecture/capabilities-and-surfaces.md](../../../docs/architecture/capabilities-and-surfaces.md), [docs/architecture/module-marketplace.md](../../../docs/architecture/module-marketplace.md).

</details>
