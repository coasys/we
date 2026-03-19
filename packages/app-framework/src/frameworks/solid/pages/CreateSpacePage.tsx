import { useAdamStore } from '@solid/stores';
import { Column } from '@we/components/solid';
import { createSignal } from 'solid-js';

export function CreateSpacePage() {
  const adamStore = useAdamStore();

  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [shared, setShared] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  async function handleCreate() {
    if (!name() || loading()) return;
    setLoading(true);
    try {
      await adamStore.createSpace(name(), description(), shared());
    } catch (error) {
      console.error('CreateSpacePage: create error', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Column p="600" gap="500" ax="center" ay="center" width="100%" height="100%">
      <Column gap="400" width="100%" maxWidth="400px">
        <we-text size="700" weight="600" color="ui-700">
          New space
        </we-text>
        <we-input
          label="Name"
          placeholder="Space name"
          value={name()}
          onInput={(e: InputEvent) => setName((e.target as HTMLInputElement)?.value)}
        />
        <we-input
          label="Description"
          placeholder="What is this space about?"
          value={description()}
          onInput={(e: InputEvent) => setDescription((e.target as HTMLInputElement)?.value)}
        />

        {/* Personal / Shared toggle using button pair */}
        <Column gap="200">
          <we-text size="300" weight="500" color="ui-600">
            Visibility
          </we-text>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <we-button
              bg={!shared() ? 'primary-500' : ''}
              color={!shared() ? 'ui-0' : 'ui-700'}
              px="300"
              py="100"
              onClick={() => setShared(false)}
            >
              Personal
            </we-button>
            <we-button
              bg={shared() ? 'primary-500' : ''}
              color={shared() ? 'ui-0' : 'ui-700'}
              px="300"
              py="100"
              onClick={() => setShared(true)}
            >
              Shared
            </we-button>
          </div>
          <we-text size="200" color="ui-500">
            {shared()
              ? 'Shared spaces are published as neighbourhoods that others can join.'
              : 'Personal spaces are private and stored locally.'}
          </we-text>
        </Column>

        <we-button
          bg="primary-500"
          color="ui-0"
          disabled={!name() || loading()}
          loading={loading()}
          onClick={handleCreate}
        >
          {loading() ? 'Creating...' : 'Create Space'}
        </we-button>
      </Column>
    </Column>
  );
}
