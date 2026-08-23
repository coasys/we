/**
 * The views compiled into this build.
 *
 * GENERATED FILE — do not edit. Rewritten by `pnpm --filter @we/app-shell generate-views`
 * from `we-seed.json`'s `views` list. Change the seed and regenerate; editing this by hand
 * is undone by the next build.
 *
 * Key order is the seed's order, and it is load-bearing: it is the default order sections appear in.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { aboutView, calendarView, cardsView, globeView, graphView, tasksView } from '@we/template-views';

export const bundledViews: Record<string, TemplateSchema> = {
  about: aboutView,
  cards: cardsView,
  graph: graphView,
  globe: globeView,
  tasks: tasksView,
  calendar: calendarView,
};
