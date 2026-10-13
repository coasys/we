/**
 * The pieces a bundle lands as — the same whether a deployment builds it in or a person installs it.
 *
 * Every id is put under the bundle's (`field-guide--species`), so a second install lands on the same
 * records and nothing a bundle brings can take the id of a built-in or of somebody's own template;
 * every template is stamped with where it came from; and every reference a bundle makes to its own
 * pieces is rewritten to match — a template's `meta.themeId`, and the template the display policy
 * names. One function for both routes, so a seed bundle and an installed one cannot drift apart in
 * what they put where.
 */
import {
  type Bundle,
  bundlePieceId,
  type BundleRecordType,
  type BundleTheme,
  type TemplateSchema,
} from '@we/schema-shared';

export interface BundlePieces {
  bundleId: string;
  version: string;
  app?: TemplateSchema & { id: string };
  /** Space templates — whole interfaces a space renders with. */
  shells: Array<TemplateSchema & { id: string }>;
  /** Sections, which a space switches on. */
  sections: Array<TemplateSchema & { id: string }>;
  theme?: BundleTheme;
  recordTypes: BundleRecordType[];
  /** The policy, with the template it names already put under the bundle's id. */
  display?: { spaces: 'ours' | 'theirs'; template?: string };
}

export function bundlePieces(bundle: Bundle): BundlePieces {
  const id = (piece: string) => bundlePieceId(bundle.id, piece);
  const themeId = bundle.theme ? id(bundle.theme.id) : undefined;

  const land = (template: TemplateSchema & { id: string }): TemplateSchema & { id: string } => {
    const copy = JSON.parse(JSON.stringify(template)) as TemplateSchema & { id: string };
    copy.id = id(template.id);
    copy.source = { bundle: bundle.id, version: bundle.version, piece: template.id };
    // A theme named by its id in the bundle means the bundle's theme; any other is left as written,
    // since it may be a built-in the app expects to be there.
    if (copy.meta.themeId && bundle.theme && copy.meta.themeId === bundle.theme.id) copy.meta.themeId = themeId;
    return copy;
  };

  const templates = (bundle.templates ?? []).map(land);
  return {
    bundleId: bundle.id,
    version: bundle.version,
    ...(bundle.app ? { app: land(bundle.app) } : {}),
    shells: templates.filter((t) => t.meta.role !== 'view'),
    sections: templates.filter((t) => t.meta.role === 'view'),
    ...(bundle.theme ? { theme: { ...bundle.theme, id: themeId! } } : {}),
    recordTypes: bundle.recordTypes ?? [],
    ...(bundle.display
      ? {
          display: {
            spaces: bundle.display.spaces,
            ...(bundle.display.template ? { template: id(bundle.display.template) } : {}),
          },
        }
      : {}),
  };
}
