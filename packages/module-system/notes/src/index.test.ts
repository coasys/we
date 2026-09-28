/**
 * The declaration — an agent-scoped module whose content is the shared vocabulary.
 */
import { validateManifest } from '@we/backend-shared';
import { checkModuleCompatibility, lintModule, moduleCapabilities } from '@we/module-shared';
import { describe, expect, it } from 'vitest';

import { NOTE_KIND, NOTE_PREDICATES, notesModule } from './index';

describe('the notes module', () => {
  it('is the agent’s, not a space’s — the manifest and its entities agree', () => {
    expect(notesModule.manifest.scope).toBe('agent');
    expect(notesModule.contributes?.entities?.scope).toBe('agent');
  });

  it('asks for the personal space and the space on screen, and nothing else', () => {
    expect(notesModule.manifest.requires?.kernels).toEqual(['agentData', 'records']);
    expect(notesModule.manifest.requires?.backends).toBeUndefined();
    expect(notesModule.manifest.requires?.frameworks).toBeUndefined();
    expect(checkModuleCompatibility(notesModule, { backend: 'inmemory', framework: 'react' }).compatible).toBe(true);
    expect(
      checkModuleCompatibility(notesModule, { backend: 'ad4m', framework: 'solid', kernels: ['records'] }).compatible,
    ).toBe(false);
  });

  it('owns where a note was shared, never the note — a note is a post', () => {
    const manifest = notesModule.contributes!.entities!.manifest;
    expect(Object.keys(manifest.entities)).toEqual(['NoteShare']);
    expect(NOTE_KIND).toBe('post');
    expect(validateManifest(manifest, { externalEntities: ['WeNode'] }).valid).toBe(true);
    for (const predicate of Object.values(NOTE_PREDICATES))
      expect(predicate.startsWith('we://module/notes/')).toBe(true);
  });

  it('lints clean, with a panel the host owns the openness of', () => {
    expect(lintModule(notesModule).problems).toEqual([]);
    const [panel] = notesModule.contributes!.panels!;
    expect(panel.name).toBe('main');
    expect(panel.open).toBeUndefined();
  });

  it('is described to a person by what it declares', () => {
    const capabilities = moduleCapabilities(notesModule);
    expect(capabilities).toContain('kernel:agentData');
    expect(capabilities).toContain('kernel:records');
    expect(capabilities).toContain('dock');
  });
});
