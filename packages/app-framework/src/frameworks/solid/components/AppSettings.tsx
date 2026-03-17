import { useTemplateStore, useThemeStore } from '@solid/stores';
import { CircleButton, Column, PopoverMenu, Row } from '@we/components/solid';
import { TemplateSchema } from '@we/schema-shared';
import { createMemo, createSignal } from 'solid-js';

export default function AppSettings() {
  const themeStore = useThemeStore();
  const templateStore = useTemplateStore();

  const [modalOpen, setModalOpen] = createSignal(false);
  const [newTemplateName, setNewTemplateName] = createSignal('');

  function mapTemplateToOption(template: TemplateSchema) {
    return {
      id: template.id || '',
      name: template.meta?.name || template.id || 'Unnamed Template',
      icon: template.meta?.icon || 'question-mark',
    };
  }

  const templateOptions = createMemo(() => templateStore.templates().map(mapTemplateToOption));
  const selectedTemplate = createMemo(() => mapTemplateToOption(templateStore.currentTemplate));

  return (
    <>
      <CircleButton
        label="App Settings"
        icon="gear"
        onClick={() => setModalOpen(!modalOpen())}
        styles={{ position: 'absolute', bottom: '10px', right: '10px', width: '50px', height: '50px' }}
      />

      {modalOpen() && (
        <we-modal close={() => setModalOpen(false)}>
          <Column gap="600" p="600" ax="center">
            <we-text size="800">App Settings</we-text>

            <Row gap="400" ay="center">
              <we-text size="600">Template:</we-text>
              <PopoverMenu
                options={templateOptions}
                selectedOption={selectedTemplate}
                onSelect={(option) => templateStore.switchTemplate(option.id)}
              />
            </Row>

            <Row gap="400" ay="center">
              <we-text size="600">Theme:</we-text>
              <PopoverMenu
                options={themeStore.themes}
                selectedOption={themeStore.currentTheme}
                onSelect={(option) => themeStore.setCurrentTheme(option.id)}
              />
            </Row>

            <we-button
              color="ui-1000"
              bg="ui-100"
              r="pill"
              hoverProps={{ bg: 'ui-200' }}
              onClick={templateStore.removeTemplate}
            >
              Remove Template
            </we-button>

            <Row gap="200">
              <we-input
                placeholder="New template name..."
                size="lg"
                style={{ width: '100%' }}
                value={newTemplateName()}
                onInput={(e: InputEvent) => setNewTemplateName((e.target as HTMLInputElement)?.value)}
                onKeyDown={(e: KeyboardEvent) => {
                  if (e.key === 'Enter' && newTemplateName().trim() !== '')
                    templateStore.saveTemplate(newTemplateName());
                }}
              />
              <we-button
                color="ui-1000"
                bg="ui-100"
                r="pill"
                hoverProps={{ bg: 'ui-200' }}
                onClick={() => templateStore.saveTemplate(newTemplateName())}
                disabled={newTemplateName().trim() === ''}
              >
                Save Template
              </we-button>
            </Row>
          </Column>
        </we-modal>
      )}
    </>
  );
}
