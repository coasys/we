import { useAdamStore } from '@solid/stores';
import { Column } from '@we/components/solid';
import { createSignal } from 'solid-js';

export function CreateSpacePage() {
  const adamStore = useAdamStore();

  const [name, setName] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [shared, setShared] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [imagePreview, setImagePreview] = createSignal<string | null>(null);
  const [imageFile, setImageFile] = createSignal<File | null>(null);

  let fileInputRef: HTMLInputElement | undefined;

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  }

  function removeImage() {
    setImageFile(null);
    setImagePreview(null);
    if (fileInputRef) fileInputRef.value = '';
  }

  async function handleCreate() {
    if (!name() || loading()) return;
    setLoading(true);
    try {
      await adamStore.createSpace(name(), description(), shared(), imageFile() ?? undefined);
    } catch (error) {
      console.error('CreateSpacePage: create error', error);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Column p="600" gap="500" ax="center" ay="center" width="100%" height="100%">
      <Column gap="400" width="100%" maxWidth="400px">
        <we-text fontSize="700" fontWeight="600" color="neutral-700">
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

        {/* Image picker */}
        <Column gap="200">
          <we-text fontSize="300" fontWeight="500" color="neutral-600">
            Image
          </we-text>
          {imagePreview() ? (
            <div style={{ position: 'relative', width: '80px', height: '80px' }}>
              <img
                src={imagePreview()!}
                alt="Space image preview"
                style={{
                  width: '80px',
                  height: '80px',
                  'border-radius': '12px',
                  'object-fit': 'cover',
                }}
              />
              <button
                type="button"
                onClick={removeImage}
                style={{
                  position: 'absolute',
                  top: '-6px',
                  right: '-6px',
                  width: '20px',
                  height: '20px',
                  'border-radius': '50%',
                  border: 'none',
                  background: 'var(--we-color-neutral-700)',
                  color: 'var(--we-color-neutral-0)',
                  cursor: 'pointer',
                  'font-size': '12px',
                  display: 'flex',
                  'align-items': 'center',
                  'justify-content': 'center',
                  padding: '0',
                }}
              >
                ✕
              </button>
            </div>
          ) : (
            <div
              onClick={() => fileInputRef?.click()}
              style={{
                width: '80px',
                height: '80px',
                'border-radius': '12px',
                border: '2px dashed var(--we-color-neutral-300)',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                cursor: 'pointer',
              }}
            >
              <we-text fontSize="400" color="neutral-400">
                +
              </we-text>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
        </Column>

        {/* Personal / Shared toggle using button pair */}
        <Column gap="200">
          <we-text fontSize="300" fontWeight="500" color="neutral-600">
            Visibility
          </we-text>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <we-button
              bg={!shared() ? 'primary-500' : ''}
              color={!shared() ? 'neutral-0' : 'neutral-700'}
              px="300"
              py="100"
              onClick={() => setShared(false)}
            >
              Personal
            </we-button>
            <we-button
              bg={shared() ? 'primary-500' : ''}
              color={shared() ? 'neutral-0' : 'neutral-700'}
              px="300"
              py="100"
              onClick={() => setShared(true)}
            >
              Shared
            </we-button>
          </div>
          <we-text fontSize="200" color="neutral-500">
            {shared()
              ? 'Shared spaces are published as neighbourhoods that others can join.'
              : 'Personal spaces are private and stored locally.'}
          </we-text>
        </Column>

        <we-button
          bg="primary-500"
          color="neutral-0"
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
