/**
 * How a type is presented — a card's display, the control each field uses, the fields a form asks
 * for — worked out from the model's own defaults and the overrides laid over them.
 *
 * A model carries its author's presentation defaults with its meaning: they came with it, and change
 * when a new version of it is published. A space, and later a board, may want something else, and
 * says so on a `TypeStyle` record — which overrides only what it sets, so everything else falls
 * through to the model. A template can still override all of it in its own nodes.
 *
 * Kept off the model on purpose. A community deciding which field titles its sighting cards is not
 * changing what a sighting is: it must not need the change a model goes through, and must not make
 * the model read as changed against wherever it came from.
 */
import type { EntitySchema, PropertySchema } from '@we/backend-shared';

/** One layer of overrides, as a `TypeStyle` record says it. Anything absent falls through. */
export interface TypePresentation {
  display?: EntitySchema['display'];
  /** By field name. */
  controls?: Record<string, NonNullable<PropertySchema['control']>>;
  authoring?: string[];
}

/** The presentation a `TypeStyle` record stores, read leniently: anything unreadable is unset. */
export function presentationOf(row: { display?: unknown; controls?: unknown; authoring?: unknown }): TypePresentation {
  const json = (value: unknown): unknown => {
    if (typeof value !== 'string' || !value) return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  };
  const display = json(row.display);
  const controls = json(row.controls);
  const authoring = json(row.authoring);
  const isObject = (v: unknown): v is Record<string, unknown> =>
    Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  return {
    ...(isObject(display) ? { display: display as EntitySchema['display'] } : {}),
    ...(isObject(controls) ? { controls: controls as TypePresentation['controls'] } : {}),
    ...(Array.isArray(authoring) && authoring.every((f) => typeof f === 'string') ? { authoring } : {}),
  };
}

/** What a `TypeStyle` record stores for a layer: each part as JSON, or empty to leave it unset. */
export function presentationFields(presentation: TypePresentation): {
  display: string;
  controls: string;
  authoring: string;
} {
  return {
    display: presentation.display ? JSON.stringify(presentation.display) : '',
    controls:
      presentation.controls && Object.keys(presentation.controls).length ? JSON.stringify(presentation.controls) : '',
    authoring: presentation.authoring ? JSON.stringify(presentation.authoring) : '',
  };
}

/**
 * The model with its presentation overridden, layer by layer, least specific first: each layer sets
 * only what it says. A display is merged slot by slot, so a space that retitles cards keeps the
 * model's summary; a control is per field; the authoring list is replaced whole, since half of one
 * ordering and half of another is no order at all. Fields a layer names that the model does not have
 * are ignored, so an override written for an older version of the model cannot break a newer one.
 */
export function withPresentation(schema: EntitySchema, ...layers: (TypePresentation | undefined)[]): EntitySchema {
  let out = schema;
  for (const layer of layers) {
    if (!layer) continue;
    const known = (field: string) => field in out.properties || field in (out.relations ?? {});
    let next: EntitySchema = out;
    if (layer.display) {
      const display = { ...(out.display ?? {}) };
      for (const slot of ['title', 'summary', 'media'] as const) {
        const field = layer.display[slot];
        if (field && known(field)) display[slot] = field;
      }
      if (layer.display.fields) display.fields = layer.display.fields.filter(known);
      next = { ...next, display };
    }
    if (layer.controls) {
      const properties = { ...next.properties };
      for (const [field, control] of Object.entries(layer.controls)) {
        if (properties[field]) properties[field] = { ...properties[field], control };
      }
      next = { ...next, properties };
    }
    if (layer.authoring) next = { ...next, authoring: { fields: layer.authoring.filter(known) } };
    out = next;
  }
  return out;
}
