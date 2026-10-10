/**
 * The vocabulary a new space starts with, read from the deployment's own starter — the one place
 * the defaults live — as a space store would hold it once the records were written.
 */
import weSeed from '../../../we-seed.json';
import { type InvolvementTypeView, parseAppliesTo, resolveInvolvementTypes } from '../src/shared/involvements';
import { defaultSpaceStarter } from '../src/shared/spaceStarter';
import type { WeSeedFile } from '../src/types/seed';

const records = defaultSpaceStarter((weSeed as unknown as WeSeedFile).spaceStarters)?.records ?? [];

/** The involvement kinds a new space is seeded with, resolved as `spaceStore.involvementTypes` would. */
export const SEEDED_INVOLVEMENT_TYPES: InvolvementTypeView[] = resolveInvolvementTypes(
  records
    .filter((record) => record.entity === 'InvolvementType')
    .map((record) => {
      const f = record.fields as Record<string, unknown>;
      return {
        id: String(record.fields?.slug),
        name: String(f.name),
        slug: String(f.slug),
        semantic: f.semantic as InvolvementTypeView['semantic'],
        reflexive: Boolean(f.reflexive),
        appliesTo: parseAppliesTo(f.appliesTo),
        icon: String(f.icon ?? ''),
        color: String(f.color ?? ''),
        retired: false,
      };
    }),
);
