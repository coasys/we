/**
 * WE's built-in views — a space's sections, each one a template in its own right.
 *
 * ## Why these are a package rather than routes inside the default template
 *
 * They were routes inside it, and the shape of that had two costs. A community wanting a seventh
 * section had to fork the whole shell, inheriting every future improvement to it as a merge
 * conflict — the unit of sharing was the entire interface when the thing anyone wanted to change was
 * one page of it. And the shell listed its sections twice, once as routes and once as a nav strip,
 * which had already drifted: the header layout listed About and Settings with Flux commented out,
 * while the sidebar layout listed Flux and neither of the others.
 *
 * Extracted, a view is the unit. It is installed, forked, published and turned off by itself; the
 * shell says only *that* it has sections, and the same resolved list drives both the routes and the
 * nav — so they cannot disagree, because there is one of them.
 *
 * ## What a view may assume
 *
 * That it renders somewhere inside a space, and nothing else. It does not know what surrounds it,
 * which segment it was given (the space's section list decides that, not `meta.segment`), or which
 * other sections exist. A view that reaches for its neighbours is a shell that has not admitted it.
 */
import type { TemplateSchema } from '@we/schema-shared';

import { aboutView } from './views/AboutView/index.ts';
import { calendarView } from './views/CalendarView/index.ts';
import { cardsView } from './views/CardsView/index.ts';
import { fluxView } from './views/FluxView/index.ts';
import { globeView } from './views/GlobeView/index.ts';
import { graphView } from './views/GraphView/index.ts';
import { tasksView } from './views/TasksView/index.ts';

export { aboutView, calendarView, cardsView, fluxView, globeView, graphView, tasksView };
export { recordPage } from './views/RecordPage';

/**
 * Every built-in view, by the id a space's section list names it with.
 *
 * The id is a stable public name — it is written into `Space.enabledViews`, into an agent's hidden
 * list, and into a share link's section segment by way of the list — so it is fixed here rather than
 * derived from a file path, exactly as `templateRegistry`'s ids are and for the same reason.
 */
export const BUILT_IN_VIEWS: Record<string, TemplateSchema> = {
  about: aboutView,
  cards: cardsView,
  graph: graphView,
  globe: globeView,
  tasks: tasksView,
  calendar: calendarView,
  flux: fluxView,
};
