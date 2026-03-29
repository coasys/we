import { Column } from '@we/components/solid';
import { CollectionBlock, ImageBlock, Space, TextBlock, WeNode } from '@we/models';
import { createSignal } from 'solid-js';

export type * from './CreateSpaceModalWidget.types';
import type { CreateSpaceModalWidgetProps } from './CreateSpaceModalWidget.types';

// type SpaceVisibility = 'hidden' | 'private' | 'public';

export function CreateSpaceModalWidget(props: CreateSpaceModalWidgetProps) {
  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  // const [locations, setLocations] = createSignal([]);
  // const [visibility, setVisibility] = createSignal<SpaceVisibility>('private');
  const [loading, setLoading] = createSignal(false);

  async function createSpace() {
    const client = props.adamClient;
    if (!client) return;
    setLoading(true);

    // Create the perspective for the space
    const spacePerspective = await client.perspective.add(name());

    // Add models to the perspectives SDNA
    const models = [Space, WeNode, ImageBlock, TextBlock, CollectionBlock];
    await Promise.all(models.map((model) => spacePerspective.ensureSDNASubjectClass(model)));

    // HACK: AD4M's ensureSDNASubjectClass resolves before the SDNA is actually ready in the perspective so we need to wait.
    await new Promise((resolve) => setTimeout(resolve, 500)); // 40ms is not enough, 50 sometimes works, 60 always worked so far

    // Create an instance of the space model and save it in the perspective
    const space = new Space(spacePerspective);
    // space.uuid = spacePerspective.uuid;
    space.name = name();
    space.description = description();
    // space.visibility = visibility();
    // space.locations = locations();
    await space.save();

    // Add the new space to the Adam store
    props.addNewSpace(space);

    props.close();
  }

  return (
    <we-modal close={props.close}>
      <Column p="600" gap="400" ax="center">
        <we-text>Create a new space</we-text>

        <we-form-field label="Name">
          <we-input
            placeholder="Space name"
            value={name()}
            onInput={(e: InputEvent) => setName((e.target as HTMLInputElement)?.value)}
          />
        </we-form-field>

        <we-form-field label="Description">
          <we-input
            placeholder="Space description"
            value={description()}
            onInput={(e: InputEvent) => setDescription((e.target as HTMLInputElement)?.value)}
          />
        </we-form-field>

        <we-button disabled={!name()} loading={loading()} onClick={createSpace}>
          Create
        </we-button>
      </Column>
    </we-modal>
  );
}
