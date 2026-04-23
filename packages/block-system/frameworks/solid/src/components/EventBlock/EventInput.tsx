import { Column, Row } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';

import { EventDisplay } from './EventDisplay';

interface EventInputProps {
  title: string | undefined;
  description: string | undefined;
  startDate: string | undefined;
  endDate: string | undefined;
  location: string | undefined;
  allDay: boolean | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
  onSelect: (e: MouseEvent) => void;
}

export function EventInput(props: EventInputProps) {
  const [showModal, setShowModal] = createSignal(false);
  const [title, setTitle] = createSignal('');
  const [startDate, setStartDate] = createSignal('');
  const [endDate, setEndDate] = createSignal('');
  const [location, setLocation] = createSignal('');
  const [description, setDescription] = createSignal('');

  function openModal(e: MouseEvent) {
    e.stopPropagation();
    setTitle(props.title || '');
    setStartDate(props.startDate || '');
    setEndDate(props.endDate || '');
    setLocation(props.location || '');
    setDescription(props.description || '');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (title().trim()) {
      props.onChange('title', title().trim());
      props.onChange('startDate', startDate());
      if (endDate()) props.onChange('endDate', endDate());
      if (location().trim()) props.onChange('location', location().trim());
      if (description().trim()) props.onChange('description', description().trim());
      closeModal();
    }
  }

  return (
    <Column class="we-event-block" onClick={props.onSelect} position="relative">
      <Show
        when={props.title}
        fallback={
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder">
            <we-icon name="calendar" />
            Add Event
          </we-button>
        }
      >
        <EventDisplay {...props} />
        <Show when={props.isSelected()}>
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder" mt="300">
            Edit Event
          </we-button>
        </Show>
      </Show>

      <Show when={showModal()}>
        <we-modal close={closeModal} p="500" width="320px" r="300">
          <form onSubmit={handleSubmit}>
            <Column gap="300">
              <we-text variant="subheading">Add Event</we-text>
              <we-form-field label="Title">
                <we-input
                  type="text"
                  value={title()}
                  on:input={(e: CustomEvent) => setTitle(e.detail)}
                  placeholder="Event title"
                />
              </we-form-field>
              <we-form-field label="Start Date">
                <we-input
                  type="datetime-local"
                  value={startDate()}
                  on:input={(e: CustomEvent) => setStartDate(e.detail)}
                />
              </we-form-field>
              <we-form-field label="End Date">
                <we-input type="datetime-local" value={endDate()} on:input={(e: CustomEvent) => setEndDate(e.detail)} />
              </we-form-field>
              <we-form-field label="Location">
                <we-input
                  type="text"
                  value={location()}
                  on:input={(e: CustomEvent) => setLocation(e.detail)}
                  placeholder="Event location"
                />
              </we-form-field>
              <we-form-field label="Description">
                <we-input
                  type="text"
                  value={description()}
                  on:input={(e: CustomEvent) => setDescription(e.detail)}
                  placeholder="Brief description"
                />
              </we-form-field>
              <Row ax="end" gap="200">
                <we-button variant="secondary" onClick={closeModal}>
                  Cancel
                </we-button>
                <we-button variant="primary" onClick={handleSubmit}>
                  Add
                </we-button>
              </Row>
            </Column>
          </form>
        </we-modal>
      </Show>
    </Column>
  );
}
