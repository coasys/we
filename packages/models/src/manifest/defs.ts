import type { EntitySchema } from '@we/backend-shared';

/**
 * One core entity, authored.
 *
 * The `entity` member is the neutral schema — the part any backend consumes. Everything beside it
 * is codegen guidance for the AD4M class this definition generates: which base class carries the
 * shared behaviour, which fields are optional at the TypeScript level, which closed vocabularies
 * deserve named union types, which relations get accessor-method declarations. Those are facts
 * about *one implementation's ergonomics*, which is why they ride beside the schema rather than
 * inside it — the manifest IR stays free of TypeScript.
 */
export interface CoreEntityDef {
  /**
   * The generated class's base. `WeNode` also merges the shared relations (comments, signals,
   * participants, calls, mentions) into the assembled manifest entry — the class inherits them,
   * so the definition never restates them.
   */
  base: 'WeNode' | 'Ad4mModel';
  /**
   * Fields emitted as `name?: type` instead of `name: type = default`. A property with no
   * `default` in its schema and no entry here would start as an empty string it never declared —
   * `Space.url` is genuinely "absent until shared", not "empty".
   */
  optional?: string[];
  /**
   * Closed vocabularies worth a named TypeScript union — `mode: SignalMode` rather than
   * `mode: string`. The alias is exported from the generated file under this name, so consumers
   * keep importing the types they already do.
   */
  unions?: Record<string, { alias: string; values: string[] }>;
  /**
   * Relations whose AD4M accessor methods (`addX`/`getX`/`removeX`, or `setX` for a to-one) get
   * companion interface declarations on the generated class. Listed rather than derived because
   * the accessors only exist where something calls them — declaring all of them would advertise
   * methods nothing has ever exercised.
   */
  methodRelations?: string[];
  /**
   * Typed HasMany relations whose class field is declared `Target[]` rather than `string[]`.
   * Cosmetic at runtime — AD4M stores URIs either way and `include` hydrates by metadata — but
   * consumers type against the hydrated shape, and the generated class must keep their code
   * compiling exactly as the hand-written one did.
   */
  typedArrays?: string[];
  /** Verbatim lines appended to the generated file — type re-exports that live beside a class. */
  passthrough?: string[];
  /** The neutral schema: own properties and own relations only. */
  entity: EntitySchema;
}
