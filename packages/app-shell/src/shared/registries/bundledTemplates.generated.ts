/**
 * The templates compiled into this build.
 *
 * GENERATED FILE — do not edit. Rewritten by `pnpm --filter @we/app-shell generate-templates`
 * from `we-seed.json`'s `templates` list. Change the seed and regenerate; editing this by hand
 * is undone by the next build.
 *
 * Generated rather than filtered at runtime so an unselected template leaves the import graph
 * entirely — a deployment that wants none of the showcase templates ships none of their bytes.
 */
import type { TemplateSchema } from '@we/schema-shared';
import { defaultTemplate } from '@we/template-default';
import {
  discordTemplate,
  eventsTemplate,
  instagramTemplate,
  kanbanTemplate,
  twitterTemplate,
  youtubeTemplate,
} from '@we/template-showcase';

export const bundledTemplates: Record<string, TemplateSchema> = {
  default: defaultTemplate,
  discord: discordTemplate,
  twitter: twitterTemplate,
  instagram: instagramTemplate,
  youtube: youtubeTemplate,
  kanban: kanbanTemplate,
  events: eventsTemplate,
};
