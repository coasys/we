/**
 * The spine picker offers what the relation seed would follow — the space's own declared
 * structure, and never the host's bookkeeping. Every core WE class carries typed relations
 * (`signals`, `runs`, `generatedBy`): offered as spines they read as choices a community made,
 * and followed they flood a tree with reactions and model runs. The same list the extraction
 * candidates exclude (`WE_PLUMBING_CLASSES`) rules them out here, at either end of the relation.
 */
import type { EntityManifestEntry } from '@we/backend-shared';
import { describe, expect, it } from 'vitest';

import { treeSpines } from '../src/shared/sources/treeSpines';

const uri = (name: string, relatedEntity: string, isCollection = false): EntityManifestEntry['properties'][number] => ({
  name,
  predicate: `disc://${name}`,
  type: 'uri',
  isCollection,
  required: false,
  writable: true,
  relatedEntity,
});

describe('treeSpines', () => {
  it('offers none of WE’s own bookkeeping relations, at either end', () => {
    // The core manifest alone carries `WeNode › signals`, `› runs`, `› generatedBy` — every one a
    // typed relation at a plumbing class. A community shape declaring the same targets beside its
    // own relation gets only its own line.
    const shapes = [
      {
        name: 'Minute',
        manifest: {
          entities: {
            Minute: {
              properties: { title: { type: 'string' } },
              relations: {
                about: { target: 'DiscussionTopic', cardinality: 'one', predicate: 'disc://about' },
                signals: { target: 'Signal', cardinality: 'many', predicate: 'disc://signals' },
                generatedBy: { target: 'ModelRun', cardinality: 'one', predicate: 'disc://generated-by' },
              },
            },
            DiscussionTopic: {
              properties: { title: { type: 'string' } },
              relations: {},
            },
          },
        },
      },
    ];

    const values = treeSpines({ shapes }).map((option) => option.value);

    expect(values).toContain('rel:*');
    expect(values).toContain('rel:Minute.about');
    // A core relation between two *content* classes is structure too — `EventBlock.location` is a
    // block pointing at a block, not furniture. It stays.
    expect(values).toContain('rel:EventBlock.location');
    // Nothing held by, or pointing at, WE's bookkeeping: no WeNode/Space/AgentSettings relations,
    // and no `signals`, `runs` or `generatedBy` on any class at all.
    const relations = values.filter((value) => value.startsWith('rel:') && value !== 'rel:*');
    expect(relations).toEqual(expect.arrayContaining(['rel:Minute.about', 'rel:EventBlock.location']));
    for (const value of relations) {
      expect(value).not.toMatch(
        /rel:(WeNode|Space|Shape|Signal|SignalType|Involvement|Placement|TypeStyle|EdgeRoute|ModelRun|Amendment|AgentSettings|SpacePreference|SpaceTemplatePreference|Template|Theme|ReadMarker|MutedAgent|Policy|Role|RoleGrant|RelationshipType|InvolvementType|TaskState|CollectionBlock|SpaceLandmark)\./,
      );
      expect(value).not.toMatch(
        /\.(signals|runs|generatedBy|typeStyles|landmarks|root|board|run|node|hiddenTemplates|installedThemes|installedTemplates|defaultTaskState|spacePreferences|screenshots)$/,
      );
    }
    expect(values).not.toContain('rel:Minute.signals');
    expect(values).not.toContain('rel:Minute.generatedBy');
  });

  it('keeps a foreign schema’s own relations beside the space’s', () => {
    const foreign: EntityManifestEntry[] = [
      {
        name: 'Author',
        targetClass: 'disc://Author',
        properties: [uri('posts', 'Post', true)],
      },
      {
        name: 'Post',
        targetClass: 'disc://Post',
        // Even an installed schema pointing at WE's bookkeeping names furniture, not structure.
        properties: [uri('author', 'Author'), uri('generatedBy', 'ModelRun')],
      },
    ];

    const values = treeSpines({ foreign }).map((option) => option.value);

    expect(values).toEqual(expect.arrayContaining(['rel:*', 'rel:Author.posts', 'rel:Post.author']));
    expect(values).not.toContain('rel:Post.generatedBy');
  });
});
