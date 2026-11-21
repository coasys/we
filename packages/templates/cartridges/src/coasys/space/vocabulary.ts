import { SOCIAL_DNA_LABELS } from '@we/template-kit';

/** One of WE's vocabulary classes, as Social DNA shows it. */
export interface WeVocabularyClass {
  name: string;
  /** The vocabulary map's bucket for it. */
  bucket: keyof typeof SOCIAL_DNA_LABELS;
  label: string;
  icon: string;
  /**
   * The list a store keeps of its records, read in place of a query of the class: the store keeps one
   * record a slug, in the community's order, where the raw records are neither.
   */
  list?: string;
}

/**
 * WE's vocabulary classes — what the vocabulary settings list — in their order and words. Display
 * data: every other class is shown as the record lists know it.
 */
export const WE_VOCABULARY: WeVocabularyClass[] = (
  [
    { name: 'SignalType', bucket: 'signals', icon: 'heart' },
    { name: 'RelationshipType', bucket: 'connections', icon: 'arrows-left-right' },
    { name: 'TaskState', bucket: 'states', icon: 'circle-half', list: 'spaceStore.taskStates' },
    { name: 'InvolvementType', bucket: 'kinds', icon: 'hand-waving', list: 'spaceStore.involvementTypes' },
    { name: 'Topic', bucket: 'topics', icon: 'hash' },
  ] as const
).map((cls) => ({ ...cls, label: SOCIAL_DNA_LABELS[cls.bucket] }));

/** Their names, as an expression's list literal. */
export const VOCABULARY_NAMES = `[${WE_VOCABULARY.map((cls) => `'${cls.name}'`).join(', ')}]`;
