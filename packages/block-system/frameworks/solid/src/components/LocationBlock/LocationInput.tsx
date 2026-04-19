import { Column, Row } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';

import { LocationDisplay } from './LocationDisplay';

interface LocationInputProps {
  name: string | undefined;
  latitude: number | undefined;
  longitude: number | undefined;
  address: string | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
  onSelect: (e: MouseEvent) => void;
}

export function LocationInput(props: LocationInputProps) {
  const [showModal, setShowModal] = createSignal(false);
  const [name, setName] = createSignal('');
  const [latitude, setLatitude] = createSignal('');
  const [longitude, setLongitude] = createSignal('');
  const [address, setAddress] = createSignal('');

  function openModal(e: MouseEvent) {
    e.stopPropagation();
    setName(props.name || '');
    setLatitude(props.latitude?.toString() || '');
    setLongitude(props.longitude?.toString() || '');
    setAddress(props.address || '');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    const n = name().trim();
    if (!n) return;
    const lat = parseFloat(latitude());
    const lng = parseFloat(longitude());
    props.onChange('name', n);
    if (!isNaN(lat)) props.onChange('latitude', lat);
    if (!isNaN(lng)) props.onChange('longitude', lng);
    if (address().trim()) props.onChange('address', address().trim());
    closeModal();
  }

  return (
    <Column class="we-location-block" onClick={props.onSelect} position="relative">
      <Show
        when={props.name}
        fallback={
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder">
            <we-icon name="map-pin" />
            Add Location
          </we-button>
        }
      >
        <LocationDisplay {...props} />
        <Show when={props.isSelected()}>
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder" mt="300">
            Edit Location
          </we-button>
        </Show>
      </Show>

      <Show when={showModal()}>
        <we-modal close={closeModal} p="500" width="320px" r="300">
          <form onSubmit={handleSubmit}>
            <Column gap="300">
              <we-text variant="subheading">Add Location</we-text>
              <we-form-field label="Name">
                <we-input
                  type="text"
                  value={name()}
                  onInput={(e: CustomEvent) => setName(e.detail)}
                  placeholder="Location name"
                />
              </we-form-field>
              <we-form-field label="Address">
                <we-input
                  type="text"
                  value={address()}
                  onInput={(e: CustomEvent) => setAddress(e.detail)}
                  placeholder="Address (optional)"
                />
              </we-form-field>
              <Row gap="200">
                <we-form-field label="Latitude" flex="1">
                  <we-input
                    type="number"
                    step="any"
                    value={latitude()}
                    onInput={(e: CustomEvent) => setLatitude(e.detail)}
                    placeholder="Latitude"
                  />
                </we-form-field>
                <we-form-field label="Longitude" flex="1">
                  <we-input
                    type="number"
                    step="any"
                    value={longitude()}
                    onInput={(e: CustomEvent) => setLongitude(e.detail)}
                    placeholder="Longitude"
                  />
                </we-form-field>
              </Row>
              <Row ax="end" gap="200">
                <we-button variant="secondary" onClick={closeModal}>
                  Cancel
                </we-button>
                <we-button variant="primary" onClick={handleSubmit} disabled={!name().trim()}>
                  Save
                </we-button>
              </Row>
            </Column>
          </form>
        </we-modal>
      </Show>
    </Column>
  );
}
