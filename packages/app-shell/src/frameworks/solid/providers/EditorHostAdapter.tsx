import { type EditorHost, EditorHostProvider } from '@we/editor/runtime';
import { compressImageToFileData, ImageBlock } from '@we/entities';
import type { ParentProps } from 'solid-js';

import { useDatasetStore } from '../stores/DatasetStore';
import { useEditorStore } from '../stores/EditorStore';
import { useEditTarget } from '../stores/editTarget';
import { useProfileStore } from '../stores/ProfileStore';
import { useSessionStore } from '../stores/SessionStore';
import { useShellStore } from '../stores/ShellStore';
import { useSpaceStore } from '../stores/SpaceStore';
import { useTemplateStore } from '../stores/TemplateStore';
import { useThemeStore } from '../stores/ThemeStore';
import { createOwnersPort } from './ownersPort';

/**
 * WE's implementation of the editor's host port.
 *
 * The editor used to call `useAiStore()` / `useThemeStore()` / … directly, which is what made it
 * unusable outside WE — and what made the dependency graph circular, since the shell also imports
 * the editor's components. This file is the whole of that coupling, in one place, pointing one way.
 *
 * Deliberately a forwarding adapter rather than a rewrite of the stores. Declaring the boundary and
 * moving state across it are separate changes; doing both at once would produce a diff where neither
 * half could be reviewed on its own. The port's member names therefore mirror the stores' — most of
 * this file is `store` — and what sits on the wrong side of the line is marked below. Migrating any
 * of it changes this file and nothing in the editor.
 */
export function EditorHostAdapter(props: ParentProps) {
  const editor = useEditorStore();
  const template = useTemplateStore();
  const theme = useThemeStore();
  const sessionStore = useSessionStore();
  const datasetStore = useDatasetStore();
  const profileStore = useProfileStore();
  const space = useSpaceStore();
  const shell = useShellStore();
  const edit = useEditTarget();

  /*
    The template port the editor edits through, answering with the edit target rather than the
    template on screen. Everything the editor does to "the current template" — the inspector, the
    overlay, the cards, the canvas — is done to whatever the session is editing, and the rest of the
    port is the template store's. A Proxy rather than a copy so the store's getters stay live.
  */
  const templatePort = new Proxy(template as unknown as EditorHost['template'], {
    get(target, key, receiver) {
      if (key === 'currentTemplate') return edit.template();
      if (key === 'updateTemplate') return edit.update;
      if (key === 'persistCurrentTemplate') return edit.persist;
      return Reflect.get(target, key, receiver);
    },
  });

  const host: EditorHost = {
    // Who provides the regions of the page the template does not own — see `ownersPort.ts`.
    owners: createOwnersPort({ space, shell, dataset: datasetStore, template }),

    // A getter, and `currentTemplate` read through the proxy each time — reading it eagerly here would
    // snapshot the template and the editor would render a stale copy after every edit.
    get template() {
      return templatePort;
    },

    // Including `editingTheme` and the `updateEditing*` family, which look like editor state and are
    // not. A theme being edited is a draft of a persisted entity that *the host renders* — the live
    // preview reads it — which makes it exactly the same shape as `currentTemplate`: the working copy
    // lives here, and the editor mutates it through the port. Moving it into the editor would put the
    // state somewhere other than the code that renders it, and require a `previewEditing` port to push
    // it back.
    theme: theme as unknown as EditorHost['theme'],

    // Forwarded whole: every member is the editor's own session state. Narrowing it here would mean
    // listing sixty members twice — it moves into the editor rather than being trimmed.
    session: editor as unknown as EditorHost['session'],

    identity: {
      me: () => sessionStore.me(),
      currentPerspective: () => datasetStore.currentDataset()?.handle ?? null,
      orderedSidebarItems: () => space.orderedSidebarItems(),
      marketplaceJoined: () => datasetStore.marketplaceJoined(),
      spaceDefaultTemplateId: () => space.spaceDefaultTemplateId(),
      spaceDefaultThemeId: () => space.spaceDefaultThemeId(),
      agents: () => profileStore.profiles(),
      fetchAgent: (did) => profileStore.fetchProfile(did),
    },

    // The background picker's two host concerns. Supplying them here is what lets the editor browse
    // and upload images without naming a model class — a host with no image storage simply omits
    // this and the picker degrades to its URL tab.
    images: {
      list: async (limit = 60) => {
        const perspective = datasetStore.currentDataset()?.handle;
        if (!perspective) return [];
        const blocks = await ImageBlock.findAll(perspective, { order: { createdAt: 'DESC' }, limit });
        return blocks.map((b) => ({ id: b.id, src: b.src, altText: b.altText }));
      },
      upload: async (file) => {
        const perspective = datasetStore.currentDataset()?.handle;
        if (!perspective) throw new Error('no dataset to upload into');
        // Standalone in the current perspective — no parent CollectionBlock, so it is reusable by
        // future browse pickers exactly like a post-authored ImageBlock.
        const fileData = await compressImageToFileData(file, 'bg-image');
        const block = await ImageBlock.create(perspective, { src: fileData });
        return block.src;
      },
    },
  };

  return <EditorHostProvider value={host}>{props.children}</EditorHostProvider>;
}
