import { Column, Row } from '@we/components/solid';
import { createSignal, Show } from 'solid-js';

import { TaskDisplay } from './TaskDisplay';

interface TaskInputProps {
  title: string | undefined;
  description: string | undefined;
  status: string | undefined;
  priority: string | undefined;
  dueDate: string | undefined;
  assignee: string | undefined;
  onChange: (property: string, value: unknown) => void;
  isSelected: () => boolean;
  onSelect: (e: MouseEvent) => void;
}

const STATUS_OPTIONS = [
  { label: 'To Do', value: 'todo' },
  { label: 'In Progress', value: 'in-progress' },
  { label: 'Done', value: 'done' },
];

const PRIORITY_OPTIONS = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
];

export function TaskInput(props: TaskInputProps) {
  const [showModal, setShowModal] = createSignal(false);
  const [title, setTitle] = createSignal('');
  const [description, setDescription] = createSignal('');
  const [status, setStatus] = createSignal('todo');
  const [priority, setPriority] = createSignal('medium');
  const [dueDate, setDueDate] = createSignal('');
  const [assignee, setAssignee] = createSignal('');

  function openModal(e: MouseEvent) {
    e.stopPropagation();
    setTitle(props.title || '');
    setDescription(props.description || '');
    setStatus(props.status || 'todo');
    setPriority(props.priority || 'medium');
    setDueDate(props.dueDate || '');
    setAssignee(props.assignee || '');
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
  }

  function handleSubmit(e: Event) {
    e.preventDefault();
    if (title().trim()) {
      props.onChange('title', title().trim());
      props.onChange('status', status());
      props.onChange('priority', priority());
      if (description().trim()) props.onChange('description', description().trim());
      if (dueDate()) props.onChange('dueDate', dueDate());
      if (assignee().trim()) props.onChange('assignee', assignee().trim());
      closeModal();
    }
  }

  return (
    <Column class="we-task-block" onClick={props.onSelect} position="relative">
      <Show
        when={props.title}
        fallback={
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder">
            <we-icon name="check-square" />
            Add Task
          </we-button>
        }
      >
        <TaskDisplay {...props} />
        <Show when={props.isSelected()}>
          <we-button variant="ghost" onClick={openModal} class="we-block-input-placeholder" mt="300">
            Edit Task
          </we-button>
        </Show>
      </Show>

      <Show when={showModal()}>
        <we-modal close={closeModal} p="500" width="320px" r="300">
          <form onSubmit={handleSubmit}>
            <Column gap="300">
              <we-text variant="subheading">Add Task</we-text>
              <we-form-field label="Title">
                <we-input
                  type="text"
                  value={title()}
                  onInput={(e: CustomEvent) => setTitle(e.detail)}
                  placeholder="Task title"
                />
              </we-form-field>
              <we-form-field label="Description">
                <we-textarea
                  value={description()}
                  onInput={(e: CustomEvent) => setDescription(e.detail)}
                  placeholder="Description (optional)"
                  rows={2}
                />
              </we-form-field>
              <Row gap="200">
                <we-form-field label="Status" flex="1">
                  <we-select
                    value={status()}
                    options={STATUS_OPTIONS}
                    onChange={(e: CustomEvent) => setStatus(e.detail)}
                  />
                </we-form-field>
                <we-form-field label="Priority" flex="1">
                  <we-select
                    value={priority()}
                    options={PRIORITY_OPTIONS}
                    onChange={(e: CustomEvent) => setPriority(e.detail)}
                  />
                </we-form-field>
              </Row>
              <Row gap="200">
                <we-form-field label="Due Date" flex="1">
                  <we-input type="date" value={dueDate()} onInput={(e: CustomEvent) => setDueDate(e.detail)} />
                </we-form-field>
                <we-form-field label="Assignee" flex="1">
                  <we-input
                    type="text"
                    value={assignee()}
                    onInput={(e: CustomEvent) => setAssignee(e.detail)}
                    placeholder="Assignee"
                  />
                </we-form-field>
              </Row>
              <Row ax="end" gap="200">
                <we-button variant="secondary" onClick={closeModal}>
                  Cancel
                </we-button>
                <we-button variant="primary" onClick={handleSubmit} disabled={!title().trim()}>
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
