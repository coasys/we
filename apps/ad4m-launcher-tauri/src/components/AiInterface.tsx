import { Column, Row } from '@we/components/solid';
import { createSignal } from 'solid-js';

import { useAiStore } from '@/stores';

// TODO: r="pill" not working yet on Row and Column

export default function AiInterface() {
  const aiStore = useAiStore();

  const [loading, setLoading] = createSignal(false);
  const [userInput, setUserInput] = createSignal('');
  const [aiResponse, setAiResponse] = createSignal('');

  async function promptAI(): Promise<void> {
    console.log('Prompting AI with:', userInput());

    setAiResponse('');
    setLoading(true);

    const response = await aiStore.handleSchemaPrompt(userInput());
    console.log('AI Response:', response);
    setUserInput('');
    setAiResponse(response ?? 'No response from AI');

    setLoading(false);
  }

  return (
    <Row ax="center" gap="400" styles={{ width: '100%', position: 'absolute', bottom: '40px' }}>
      <Column styles={{ width: '100%', 'max-width': '900px' }}>
        {aiResponse() && (
          <Row ay="center" gap="400" bg="ui-50" p="400" r="sm" mb="400">
            <we-icon name="robot" color="ui-600" size="lg" weight="duotone" />
            <we-text size="500" color="ui-600" tag="i">
              {aiResponse()}
            </we-text>
          </Row>
        )}
        <Row ay="center" gap="400" bg="ui-200" p="400" r="sm">
          <we-input
            placeholder="Prompt AI with your schema request..."
            size="lg"
            style={{ width: '100%' }}
            value={userInput()}
            onInput={(e: InputEvent) => setUserInput((e.target as HTMLInputElement)?.value)}
            onKeyDown={(e: KeyboardEvent) => {
              if (e.key === 'Enter') promptAI();
            }}
          />
          <we-button
            px="400"
            py="300"
            r="pill"
            color="ui-1000"
            hover={{ bg: 'ui-50' }}
            onClick={promptAI}
            loading={loading()}
            disabled={loading() || userInput().trim() === ''}
          >
            Prompt
          </we-button>
        </Row>
      </Column>
    </Row>
  );
}
